"""
mft_scan.py
===========
Direct NTFS Master File Table (MFT) scanner.

Advantages over os.walk / os.scandir:
  - Single kernel call reads the entire MFT in large chunks.  No per-file
    syscalls.
  - Extracts name, size, timestamps, parent reference and computes full paths.
  - Results are cached for CACHE_TTL seconds, so repeat searches are instant.

Limitations:
  - Requires administrator privileges (raw volume read).
  - Only works on NTFS volumes.
  - Falls back gracefully when admin rights are missing.
"""

import ctypes
import struct
import threading
import time
from ctypes import wintypes

# ──────────────────────────────────────────────────────────────────────────────
# Win32 constants
# ──────────────────────────────────────────────────────────────────────────────
GENERIC_READ                = 0x80000000
FILE_SHARE_READ             = 0x00000001
FILE_SHARE_WRITE            = 0x00000002
OPEN_EXISTING               = 3
FSCTL_GET_NTFS_VOLUME_DATA  = 0x00090064

# MFT Attribute type codes
ATTR_STANDARD_INFORMATION   = 0x10
ATTR_ATTRIBUTE_LIST         = 0x20
ATTR_FILE_NAME              = 0x30
ATTR_DATA                   = 0x80

# Windows FILETIME epoch difference (100-ns intervals from 1601-01-01 to 1970-01-01)
_FILETIME_EPOCH_DIFF = 116_444_736_000_000_000

# MFT root directory record number
_ROOT_RECORD_NUM = 5


# ──────────────────────────────────────────────────────────────────────────────
# NTFS volume data structure
# ──────────────────────────────────────────────────────────────────────────────
class NTFS_VOLUME_DATA_BUFFER(ctypes.Structure):
    _fields_ = [
        ("VolumeSerialNumber",           wintypes.LARGE_INTEGER),
        ("NumberSectors",                wintypes.LARGE_INTEGER),
        ("TotalClusters",                wintypes.LARGE_INTEGER),
        ("FreeClusters",                 wintypes.LARGE_INTEGER),
        ("TotalReserved",                wintypes.LARGE_INTEGER),
        ("BytesPerSector",               wintypes.DWORD),
        ("BytesPerCluster",              wintypes.DWORD),
        ("BytesPerFileRecordSegment",    wintypes.DWORD),
        ("ClustersPerFileRecordSegment", wintypes.DWORD),
        ("MftValidDataLength",           wintypes.LARGE_INTEGER),
        ("MftStartLcn",                  wintypes.LARGE_INTEGER),
        ("Mft2StartLcn",                 wintypes.LARGE_INTEGER),
        ("MftZoneStart",                 wintypes.LARGE_INTEGER),
        ("MftZoneEnd",                   wintypes.LARGE_INTEGER),
    ]


# ──────────────────────────────────────────────────────────────────────────────
# Result cache  {letter -> {records, path_map, ts}}
# ──────────────────────────────────────────────────────────────────────────────
CACHE_TTL   = 600          # seconds before the cache is considered stale (10 min)
_cache_lock = threading.Lock()
_drive_cache: dict = {}


def _is_cache_valid(letter: str) -> bool:
    entry = _drive_cache.get(letter.upper())
    return bool(entry and time.time() - entry["ts"] < CACHE_TTL)


def _get_cache(letter: str):
    return _drive_cache.get(letter.upper())


def _set_cache(letter: str, records: list, path_map: dict) -> None:
    with _cache_lock:
        _drive_cache[letter.upper()] = {"records": records, "path_map": path_map, "ts": time.time()}


def invalidate_cache(letter: str = None) -> None:
    """Invalidate cache for one drive letter (pass None for all drives)."""
    with _cache_lock:
        if letter:
            _drive_cache.pop(letter.upper(), None)
        else:
            _drive_cache.clear()


# ──────────────────────────────────────────────────────────────────────────────
# Low-level Win32 helpers
# ──────────────────────────────────────────────────────────────────────────────
def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _filetime_to_unix(filetime: int) -> float:
    """Convert a Windows FILETIME value to a Unix timestamp (float seconds)."""
    if filetime == 0:
        return 0.0
    try:
        return (filetime - _FILETIME_EPOCH_DIFF) / 10_000_000
    except Exception:
        return 0.0


def _get_drive_handle(drive_letter: str):
    handle = ctypes.windll.kernel32.CreateFileW(
        f"\\\\.\\{drive_letter}:",
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        None,
        OPEN_EXISTING,
        0,
        None,
    )
    return None if handle == -1 else handle


def _get_ntfs_volume_data(handle) -> NTFS_VOLUME_DATA_BUFFER | None:
    buf      = NTFS_VOLUME_DATA_BUFFER()
    returned = wintypes.DWORD()
    ok = ctypes.windll.kernel32.DeviceIoControl(
        handle, FSCTL_GET_NTFS_VOLUME_DATA,
        None, 0,
        ctypes.byref(buf), ctypes.sizeof(buf),
        ctypes.byref(returned), None,
    )
    return buf if ok else None


# ──────────────────────────────────────────────────────────────────────────────
# MFT record parser
# ──────────────────────────────────────────────────────────────────────────────
def _parse_mft_record(data: bytes, record_size: int, sequential_idx: int) -> dict | None:
    """
    Parse one raw MFT FILE record.

    Returns None for unused / corrupt records.
    Successful parse yields:
      record_num  int     MFT record index (from header at 0x2C, NTFS 3.1+)
      name        str     Filename (Win32/Win32+DOS namespace preferred)
      is_dir      bool
      parent_ref  int     Parent directory record number (lower 48 bits)
      size        int     Bytes (from unnamed $DATA stream)
      created     float   Unix timestamp
      modified    float   Unix timestamp
      accessed    float   Unix timestamp
    """
    if len(data) < 0x30 or data[:4] != b"FILE":
        return None

    try:
        first_attr_off = struct.unpack_from("<H", data, 0x14)[0]
        flags          = struct.unpack_from("<H", data, 0x16)[0]
    except struct.error:
        return None

    if not (flags & 0x01):          # record not in use
        return None

    is_dir = bool(flags & 0x02)

    # Record number at offset 0x2C (NTFS 3.1+, i.e. Windows XP and later)
    try:
        record_num = struct.unpack_from("<I", data, 0x2C)[0]
    except Exception:
        record_num = sequential_idx

    result: dict = {
        "record_num": record_num,
        "name":       None,
        "is_dir":     is_dir,
        "parent_ref": None,
        "size":       0,
        "created":    0.0,
        "modified":   0.0,
        "accessed":   0.0,
    }

    offset = first_attr_off
    while offset + 8 <= len(data):
        try:
            attr_type, attr_len = struct.unpack_from("<II", data, offset)
        except struct.error:
            break

        if attr_type == 0xFFFFFFFF:
            break
        if attr_len == 0 or attr_len > record_size:
            break

        non_resident = data[offset + 8]

        # ── $STANDARD_INFORMATION (timestamps) ────────────────────────────
        if attr_type == ATTR_STANDARD_INFORMATION and not non_resident:
            try:
                c_off = struct.unpack_from("<H", data, offset + 0x14)[0]
                abs_  = offset + c_off
                if abs_ + 32 <= len(data):
                    result["created"]  = _filetime_to_unix(struct.unpack_from("<Q", data, abs_     )[0])
                    result["modified"] = _filetime_to_unix(struct.unpack_from("<Q", data, abs_ +  8)[0])
                    result["accessed"] = _filetime_to_unix(struct.unpack_from("<Q", data, abs_ + 24)[0])
            except Exception:
                pass

        # ── $FILE_NAME (name + parent ref) ────────────────────────────────
        elif attr_type == ATTR_FILE_NAME and not non_resident:
            try:
                c_off = struct.unpack_from("<H", data, offset + 0x14)[0]
                abs_  = offset + c_off
                if abs_ + 66 <= len(data):
                    parent_ref = struct.unpack_from("<Q", data, abs_)[0] & 0x0000_FFFF_FFFF_FFFF
                    name_len   = data[abs_ + 64]
                    namespace  = data[abs_ + 65]   # 0=POSIX 1=Win32 2=DOS 3=Win32+DOS
                    end = abs_ + 66 + name_len * 2
                    if end <= len(data):
                        name = data[abs_ + 66: end].decode("utf-16-le", errors="replace")
                        # Prefer Win32 (1) or Win32+DOS (3) over POSIX (0) / DOS-only (2)
                        if result["name"] is None or namespace in (1, 3):
                            result["name"]       = name
                            result["parent_ref"] = parent_ref
            except Exception:
                pass

        # ── $DATA (file size) ─────────────────────────────────────────────
        elif attr_type == ATTR_DATA:
            try:
                if data[offset + 9] == 0:           # unnamed stream only
                    if non_resident:
                        if offset + 0x38 <= len(data):
                            result["size"] = struct.unpack_from("<Q", data, offset + 0x30)[0]
                    else:
                        if offset + 0x14 <= len(data):
                            result["size"] = struct.unpack_from("<I", data, offset + 0x10)[0]
            except Exception:
                pass

        offset += attr_len

    return result if result["name"] else None


# ──────────────────────────────────────────────────────────────────────────────
# Path resolution  (iterative, O(n), no recursion limit issues)
# ──────────────────────────────────────────────────────────────────────────────
def build_path_map(records: list, drive_letter: str) -> dict:
    """
    Compute {record_num: full_path} for every record in *records*.

    Uses an iterative parent-chain walk to avoid recursion limits.
    The MFT root (record 5) anchors at "X:\\".
    """
    root_path  = drive_letter.upper() + ":\\"
    lookup     = {r["record_num"]: r for r in records if r.get("record_num") is not None}
    path_cache: dict[int, str] = {_ROOT_RECORD_NUM: root_path}

    def _resolve(start_rn: int) -> str:
        if start_rn in path_cache:
            return path_cache[start_rn]

        chain:   list[tuple[int, str]] = []
        current = start_rn
        visited: set[int] = set()

        while current not in path_cache:
            if current == _ROOT_RECORD_NUM or current in visited:
                path_cache[current] = root_path
                break
            visited.add(current)

            info = lookup.get(current)
            if not info:
                path_cache[current] = root_path
                break

            name   = info.get("name") or ""
            parent = info.get("parent_ref")
            chain.append((current, name))

            if parent is None or parent == current:
                path_cache[current] = root_path
                break
            current = parent

        # Propagate forward down the chain
        base = path_cache.get(current, root_path)
        for rn, name in reversed(chain):
            sep  = "" if base.endswith("\\") else "\\"
            base = base + sep + name
            path_cache[rn] = base

        return path_cache.get(start_rn, root_path)

    for r in records:
        rn = r.get("record_num")
        if rn is not None and rn not in path_cache:
            _resolve(rn)

    return path_cache


# ──────────────────────────────────────────────────────────────────────────────
# Core scan  (raw MFT sequential read)
# ──────────────────────────────────────────────────────────────────────────────
def scan_drive(drive_letter: str = "C") -> list:
    """
    Read the full MFT of *drive_letter* and return a flat list of record dicts.
    Each dict: record_num, name, is_dir, parent_ref, size, created, modified,
               accessed.
    Full paths are NOT resolved here — call build_path_map() afterwards.
    """
    if not is_admin():
        print(f"[mft_scan] Not running as admin; scan for {drive_letter}: may fail.")

    handle = _get_drive_handle(drive_letter)
    if not handle:
        print(f"[mft_scan] Cannot open handle for {drive_letter}:")
        return []

    ntfs = _get_ntfs_volume_data(handle)
    if not ntfs:
        ctypes.windll.kernel32.CloseHandle(handle)
        print(f"[mft_scan] Cannot read NTFS volume data for {drive_letter}:")
        return []

    mft_offset       = ntfs.MftStartLcn * ntfs.BytesPerCluster
    bytes_per_record = ntfs.BytesPerFileRecordSegment
    total_records    = ntfs.MftValidDataLength // bytes_per_record

    pos = wintypes.LARGE_INTEGER(mft_offset)
    ctypes.windll.kernel32.SetFilePointerEx(handle, pos, None, 0)

    CHUNK = 1024 * 1024                     # 1 MB read at a time
    MAX   = total_records + 1_000           # safety cap

    buf        = ctypes.create_string_buffer(CHUNK)
    bytes_read = wintypes.DWORD()

    files:       list = []
    sequential:  int  = 0
    empty_streak: int = 0

    try:
        while sequential < MAX:
            ok = ctypes.windll.kernel32.ReadFile(handle, buf, CHUNK, ctypes.byref(bytes_read), None)
            if not ok or bytes_read.value == 0:
                break

            chunk = buf.raw[: bytes_read.value]
            for i in range(0, len(chunk), bytes_per_record):
                rec = chunk[i: i + bytes_per_record]
                if len(rec) < bytes_per_record:
                    break

                info = _parse_mft_record(rec, bytes_per_record, sequential)
                if info:
                    files.append(info)
                    empty_streak = 0
                else:
                    empty_streak += 1

                sequential += 1

            if empty_streak > 50_000:
                break

    except Exception as exc:
        print(f"[mft_scan] Error: {exc}")
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)

    return files


# ──────────────────────────────────────────────────────────────────────────────
# High-level API (cache-aware)
# ──────────────────────────────────────────────────────────────────────────────
def _ensure_cached(drive_letter: str) -> dict | None:
    letter = drive_letter.upper()
    if not _is_cache_valid(letter):
        records  = scan_drive(letter)
        path_map = build_path_map(records, letter)
        _set_cache(letter, records, path_map)
    return _get_cache(letter)


def search_volume(drive_letter: str, query: str,
                  is_dir_filter=None, max_results: int = 300) -> list:
    """
    Search for files/folders by name substring across the whole NTFS volume.

    Uses the MFT cache — instant if the drive was scanned recently.
    Returns: [{name, full_path, is_dir, size, created, modified, accessed}]
    """
    ql     = query.lower()
    cached = _ensure_cached(drive_letter)
    if not cached:
        return []

    records  = cached["records"]
    path_map = cached["path_map"]
    results  = []

    for r in records:
        name = r.get("name") or ""
        if ql not in name.lower():
            continue
        if is_dir_filter is not None and r.get("is_dir") != is_dir_filter:
            continue
        rn = r.get("record_num")
        results.append({
            "name":      name,
            "full_path": path_map.get(rn, "") if rn is not None else "",
            "is_dir":    r.get("is_dir", False),
            "size":      r.get("size", 0),
            "created":   r.get("created", 0.0),
            "modified":  r.get("modified", 0.0),
            "accessed":  r.get("accessed", 0.0),
        })
        if len(results) >= max_results:
            break

    return results


def get_volume_stats(drive_letter: str) -> dict:
    """
    Compute volume-wide statistics using the MFT cache.

    Returns:
      total_files, total_dirs, total_size,
      extensions_by_count [{ext, count}],
      extensions_by_size  [{ext, size}],
      largest_files       [{name, full_path, size}]  (top 20)
    """
    cached = _ensure_cached(drive_letter)
    if not cached:
        return {"error": "Could not scan volume"}

    records  = cached["records"]
    path_map = cached["path_map"]

    total_files = total_dirs = total_size = 0
    ext_count: dict = {}
    ext_size:  dict = {}
    file_list: list = []

    for r in records:
        if r.get("is_dir"):
            total_dirs += 1
            continue
        total_files += 1
        sz = r.get("size", 0)
        total_size += sz

        name = r.get("name") or ""
        ext  = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        ext_count[ext] = ext_count.get(ext, 0) + 1
        ext_size[ext]  = ext_size.get(ext, 0)  + sz
        file_list.append(r)

    largest = sorted(file_list, key=lambda x: x.get("size", 0), reverse=True)[:20]

    return {
        "total_files":         total_files,
        "total_dirs":          total_dirs,
        "total_size":          total_size,
        "extensions_by_count": [{"ext": e, "count": c} for e, c in sorted(ext_count.items(), key=lambda x: -x[1])[:10]],
        "extensions_by_size":  [{"ext": e, "size": s}  for e, s in sorted(ext_size.items(), key=lambda x: -x[1])[:10]],
        "largest_files":       [{"name": r.get("name",""), "full_path": path_map.get(r.get("record_num"),""), "size": r.get("size",0)} for r in largest],
    }


def list_directory_mft(drive_letter: str, dir_path: str) -> list | None:
    """
    List the immediate children of *dir_path* using the MFT cache.

    Returns None if the directory cannot be located in the cached MFT data
    (the caller should fall back to os.scandir in that case).

    Each item: {name, full_path, is_dir, size, created, modified, accessed}
    """
    cached = _ensure_cached(drive_letter)
    if not cached:
        return None

    records  = cached["records"]
    path_map = cached["path_map"]

    norm_target = dir_path.rstrip("\\/").lower()

    parent_rn = None
    for rn, path in path_map.items():
        if path.rstrip("\\/").lower() == norm_target:
            parent_rn = rn
            break

    if parent_rn is None:
        return None

    children = []
    for r in records:
        if r.get("parent_ref") == parent_rn:
            rn = r.get("record_num")
            children.append({
                "name":      r.get("name", ""),
                "full_path": path_map.get(rn, "") if rn is not None else "",
                "is_dir":    r.get("is_dir", False),
                "size":      r.get("size", 0),
                "created":   r.get("created", 0.0),
                "modified":  r.get("modified", 0.0),
                "accessed":  r.get("accessed", 0.0),
            })

    return children
