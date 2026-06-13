import ctypes
import struct
import threading
import time
from ctypes import wintypes

GENERIC_READ                    = 0x80000000
FILE_SHARE_READ                 = 0x00000001
FILE_SHARE_WRITE                = 0x00000002
OPEN_EXISTING                   = 3
FSCTL_GET_NTFS_VOLUME_DATA      = 0x00090064
FSCTL_ALLOW_EXTENDED_DASD_IO    = 0x00090083   # required on Win10/11 for raw volume reads
INVALID_HANDLE_VALUE            = ctypes.c_void_p(-1).value

# Typed Win32 function bindings — required on x64 to get the calling convention right.
_k32 = ctypes.windll.kernel32

_CreateFileW = _k32.CreateFileW
_CreateFileW.restype  = ctypes.c_void_p   # HANDLE is pointer-sized on x64
_CreateFileW.argtypes = [
    ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32,
    ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
]

_DeviceIoControl = _k32.DeviceIoControl
_DeviceIoControl.restype  = wintypes.BOOL
_DeviceIoControl.argtypes = [
    ctypes.c_void_p, wintypes.DWORD,
    ctypes.c_void_p, wintypes.DWORD,
    ctypes.c_void_p, wintypes.DWORD,
    ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p,
]

_SetFilePointerEx = _k32.SetFilePointerEx
_SetFilePointerEx.restype  = wintypes.BOOL
_SetFilePointerEx.argtypes = [
    ctypes.c_void_p,                    # hFile
    ctypes.c_int64,                     # liDistanceToMove (LARGE_INTEGER by value)
    ctypes.POINTER(ctypes.c_int64),     # lpNewFilePointer (optional, can be NULL)
    wintypes.DWORD,                     # dwMoveMethod
]

_ReadFile = _k32.ReadFile
_ReadFile.restype  = wintypes.BOOL
_ReadFile.argtypes = [
    ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD,
    ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p,
]

_CloseHandle = _k32.CloseHandle
_CloseHandle.restype  = wintypes.BOOL
_CloseHandle.argtypes = [ctypes.c_void_p]

ATTR_STANDARD_INFORMATION   = 0x10
ATTR_ATTRIBUTE_LIST         = 0x20
ATTR_FILE_NAME              = 0x30
ATTR_DATA                   = 0x80

# Windows FILETIME epoch difference (100-ns intervals from 1601-01-01 to 1970-01-01)
_FILETIME_EPOCH_DIFF = 116_444_736_000_000_000

_ROOT_RECORD_NUM = 5



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



CACHE_TTL   = 600
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
    with _cache_lock:
        if letter:
            _drive_cache.pop(letter.upper(), None)
        else:
            _drive_cache.clear()



def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _filetime_to_unix(filetime: int) -> float:
    if filetime == 0:
        return 0.0
    try:
        return (filetime - _FILETIME_EPOCH_DIFF) / 10_000_000
    except Exception:
        return 0.0


def _get_drive_handle(drive_letter: str):
    handle = _CreateFileW(
        f"\\\\.\\{drive_letter}:",
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        None,
        OPEN_EXISTING,
        0,
        None,
    )
    if handle is None or handle == INVALID_HANDLE_VALUE:
        return None
    # Required on Windows 10/11: enables raw reads beyond the partition boundary.
    # Without this, SetFilePointerEx succeeds but ReadFile returns 0 bytes.
    returned = wintypes.DWORD()
    _DeviceIoControl(handle, FSCTL_ALLOW_EXTENDED_DASD_IO, None, 0, None, 0, ctypes.byref(returned), None)
    return handle


def _get_ntfs_volume_data(handle) -> NTFS_VOLUME_DATA_BUFFER | None:
    buf      = NTFS_VOLUME_DATA_BUFFER()
    returned = wintypes.DWORD()
    ok = _DeviceIoControl(
        handle, FSCTL_GET_NTFS_VOLUME_DATA,
        None, 0,
        ctypes.byref(buf), ctypes.sizeof(buf),
        ctypes.byref(returned), None,
    )
    return buf if ok else None



def _apply_usa_fixup(data: bytearray, record_size: int) -> None:
    try:
        if len(data) < 8:
            return
        usa_off   = struct.unpack_from("<H", data, 4)[0]   # USA offset in record
        usa_count = struct.unpack_from("<H", data, 6)[0]   # sectors + 1
        if usa_off < 8 or usa_count <= 1 or usa_off + usa_count * 2 > len(data):
            return
        usn = struct.unpack_from("<H", data, usa_off)[0]   # current tag value
        for i in range(usa_count - 1):
            sec_end = (i + 1) * 512 - 2                    # offset of last 2 bytes in sector i
            if sec_end + 2 > record_size:
                break
            if struct.unpack_from("<H", data, sec_end)[0] == usn:
                orig = struct.unpack_from("<H", data, usa_off + 2 + i * 2)[0]
                struct.pack_into("<H", data, sec_end, orig)
    except Exception:
        pass



def _parse_mft_record(data: bytes, record_size: int, sequential_idx: int) -> dict | None:
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



def build_path_map(records: list, drive_letter: str) -> dict:
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



def _parse_runlist(data: bytes, start_off: int) -> list:
    runs    = []
    off     = start_off
    prev_lcn = 0
    while off < len(data):
        header = data[off]
        if header == 0:
            break
        len_size = (header >> 4) & 0xF
        off_size = header & 0xF
        off += 1
        if len_size == 0 or off + len_size > len(data):
            break
        n_clusters = int.from_bytes(data[off: off + len_size], "little", signed=False)
        off += len_size
        if off_size == 0:
            runs.append((-1, n_clusters))
        else:
            if off + off_size > len(data):
                break
            delta = int.from_bytes(data[off: off + off_size], "little", signed=True)
            off += off_size
            prev_lcn += delta
            runs.append((prev_lcn, n_clusters))
    return runs


def _read_mft_runlist(handle, mft_offset: int, bytes_per_record: int) -> list:
    ok = _SetFilePointerEx(handle, mft_offset, None, 0)
    if not ok:
        return []
    buf        = ctypes.create_string_buffer(bytes_per_record)
    bytes_read = wintypes.DWORD()
    ok = _ReadFile(handle, buf, bytes_per_record, ctypes.byref(bytes_read), None)
    if not ok or bytes_read.value < bytes_per_record:
        return []
    rec = bytearray(buf.raw[: bytes_per_record])
    _apply_usa_fixup(rec, bytes_per_record)
    if rec[:4] != b"FILE":
        return []
    try:
        first_attr_off = struct.unpack_from("<H", rec, 0x14)[0]
    except Exception:
        return []
    offset = first_attr_off
    while offset + 8 <= bytes_per_record:
        try:
            attr_type, attr_len = struct.unpack_from("<II", rec, offset)
        except Exception:
            break
        if attr_type == 0xFFFFFFFF or attr_len == 0:
            break
        if attr_type == ATTR_DATA and rec[offset + 8] == 1 and rec[offset + 9] == 0:  # unnamed non-resident $DATA
            try:
                rl_off = struct.unpack_from("<H", rec, offset + 0x20)[0]
                return _parse_runlist(bytes(rec), offset + rl_off)
            except Exception:
                return []
        offset += attr_len
    return []



def scan_drive(drive_letter: str = "C") -> list:
    if not is_admin():
        print(f"[mft_scan] Not running as admin; scan for {drive_letter}: will fail.")

    handle = _get_drive_handle(drive_letter)
    if not handle:
        err = ctypes.windll.kernel32.GetLastError()
        print(f"[mft_scan] Cannot open volume handle for {drive_letter}: Win32 error {err}")
        return []

    ntfs = _get_ntfs_volume_data(handle)
    if not ntfs:
        err = ctypes.windll.kernel32.GetLastError()
        _CloseHandle(handle)
        print(f"[mft_scan] Cannot read NTFS volume data for {drive_letter}: Win32 error {err}")
        return []

    mft_offset        = int(ntfs.MftStartLcn) * int(ntfs.BytesPerCluster)
    bytes_per_record  = int(ntfs.BytesPerFileRecordSegment)
    bytes_per_cluster = int(ntfs.BytesPerCluster)
    total_records     = int(ntfs.MftValidDataLength) // bytes_per_record

    print(f"[mft_scan] {drive_letter}: MFT offset={mft_offset} bpr={bytes_per_record} total_records~={total_records}")

    # Read the $MFT run list so fragmented MFTs are covered in full.
    mft_runs = _read_mft_runlist(handle, mft_offset, bytes_per_record)
    if mft_runs:
        print(f"[mft_scan] {drive_letter}: $MFT has {len(mft_runs)} run(s)")
    else:
        n_clusters = (int(ntfs.MftValidDataLength) + bytes_per_cluster - 1) // bytes_per_cluster
        mft_runs   = [(int(ntfs.MftStartLcn), n_clusters)]
        print(f"[mft_scan] {drive_letter}: using single-run fallback ({n_clusters} clusters)")

    CHUNK      = 1024 * 1024
    buf        = ctypes.create_string_buffer(CHUNK)
    bytes_read = wintypes.DWORD()

    files:      list = []
    sequential: int  = 0

    try:
        for run_lcn, run_clusters in mft_runs:
            if sequential >= total_records:
                break

            if run_lcn < 0:
                sequential += (run_clusters * bytes_per_cluster) // bytes_per_record  # sparse run — skip
                continue

            run_byte_offset = run_lcn * bytes_per_cluster
            run_bytes_total = run_clusters * bytes_per_cluster

            ok = _SetFilePointerEx(handle, run_byte_offset, None, 0)
            if not ok:
                err = ctypes.windll.kernel32.GetLastError()
                print(f"[mft_scan] SetFilePointerEx failed for run LCN={run_lcn}: err={err}")
                continue

            remaining = run_bytes_total
            while remaining > 0 and sequential < total_records:
                to_read = min(CHUNK, remaining)
                ok = _ReadFile(handle, buf, to_read, ctypes.byref(bytes_read), None)
                if not ok or bytes_read.value == 0:
                    err = ctypes.windll.kernel32.GetLastError()
                    print(f"[mft_scan] ReadFile stopped in run LCN={run_lcn} seq={sequential}: err={err}")
                    break
                chunk      = buf.raw[: bytes_read.value]
                remaining -= bytes_read.value

                for i in range(0, len(chunk), bytes_per_record):
                    rec = bytearray(chunk[i: i + bytes_per_record])
                    if len(rec) < bytes_per_record:
                        break
                    _apply_usa_fixup(rec, bytes_per_record)
                    info = _parse_mft_record(bytes(rec), bytes_per_record, sequential)
                    if info:
                        files.append(info)
                    sequential += 1

    except Exception as exc:
        print(f"[mft_scan] Error during read: {exc}")
    finally:
        _CloseHandle(handle)

    print(f"[mft_scan] {drive_letter}: scan complete — {len(files)} records found")
    return files



def resolve_dir_mft_prefix(path_map: dict, dir_path: str) -> str | None:
    try:
        ino = os.stat(dir_path).st_ino & 0xFFFF_FFFF  # match 32-bit record_num
        if ino in path_map:
            prefix = path_map[ino].rstrip("\\") + "\\"
            return prefix
    except Exception:
        pass

    candidates: set[str] = set()
    candidates.add(os.path.normpath(dir_path).lower().rstrip("\\"))
    try:
        candidates.add(os.path.normpath(os.path.realpath(dir_path)).lower().rstrip("\\"))
    except Exception:
        pass

    for rn, path in path_map.items():
        if path.lower().rstrip("\\") in candidates:
            return path.rstrip("\\") + "\\"

    return None



def _ensure_cached(drive_letter: str) -> dict | None:
    letter = drive_letter.upper()
    if not _is_cache_valid(letter):
        records  = scan_drive(letter)
        path_map = build_path_map(records, letter)
        _set_cache(letter, records, path_map)
    return _get_cache(letter)


def search_volume(drive_letter: str, query: str,
                  is_dir_filter=None, max_results: int = 300) -> list:
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


import os

def _fallback_space_analyzer(target_dir: str) -> dict:
    try:
        if not os.path.exists(target_dir):
            return {"error": "Path does not exist"}
            
        children = []
        total_size = 0

        def get_dir_size(path):
            total = 0
            try:
                with os.scandir(path) as it:
                    for entry in it:
                        try:
                            if entry.is_file(follow_symlinks=False):
                                total += entry.stat(follow_symlinks=False).st_size
                            elif entry.is_dir(follow_symlinks=False):
                                total += get_dir_size(entry.path)
                        except Exception:
                            pass
            except Exception:
                pass
            return total

        with os.scandir(target_dir) as it:
            for entry in it:
                try:
                    stat = entry.stat(follow_symlinks=False)
                    is_dir = entry.is_dir(follow_symlinks=False)
                    size = get_dir_size(entry.path) if is_dir else stat.st_size
                    total_size += size
                    children.append({
                        "name": entry.name,
                        "full_path": entry.path,
                        "is_dir": is_dir,
                        "size": size,
                        "created": stat.st_ctime,
                        "modified": stat.st_mtime,
                        "accessed": stat.st_atime,
                    })
                except Exception:
                    continue
                    
        children.sort(key=lambda x: x["size"], reverse=True)
        return {
            "path": target_dir,
            "total_size": total_size,
            "children": children[:5000]
        }
    except Exception as e:
        return {"error": f"Scandir fallback failed: {e}"}

def get_space_analyzer_data(drive_letter: str, dir_path: str = None) -> dict:
    cached = _ensure_cached(drive_letter)
    if not cached or not cached.get("records"):
        # Fallback to slow os.scandir if MFT scanning fails (e.g. no Admin rights)
        target = dir_path if dir_path else f"{drive_letter}:\\"
        return _fallback_space_analyzer(target)

    records = cached["records"]
    path_map = cached["path_map"]

    if "folder_sizes" not in cached:
        parents = {r.get("record_num"): r.get("parent_ref") for r in records if r.get("record_num") is not None}
        fsizes = {}
        for r in records:
            if r.get("is_dir") or r.get("size", 0) == 0:
                continue
            sz = r.get("size", 0)
            curr = r.get("parent_ref")
            visited = set()
            while curr is not None and curr != _ROOT_RECORD_NUM and curr not in visited:
                visited.add(curr)
                fsizes[curr] = fsizes.get(curr, 0) + sz
                curr = parents.get(curr)
            if curr == _ROOT_RECORD_NUM:
                fsizes[curr] = fsizes.get(curr, 0) + sz
        cached["folder_sizes"] = fsizes

    fsizes = cached["folder_sizes"]

    target_rn = _ROOT_RECORD_NUM
    if dir_path and dir_path.strip("\\/"):
        norm_target = dir_path.rstrip("\\/").replace("/", "\\").lower()
        if not norm_target.endswith(":"):
            found = False
            for rn, path in path_map.items():
                if path.rstrip("\\/").replace("/", "\\").lower() == norm_target:
                    target_rn = rn
                    found = True
                    break
            if not found:
                # MFT path resolution failed (e.g. C: junction points corrupt some paths).
                # Fall back to direct filesystem scan so the correct folder is always shown.
                return _fallback_space_analyzer(dir_path)

    children = []
    for r in records:
        if r.get("parent_ref") == target_rn:
            rn = r.get("record_num")
            # For root, parent_ref can sometimes equal record_num in bad MFTs, exclude self
            if rn == target_rn:
                continue
            is_dir = r.get("is_dir", False)
            size = fsizes.get(rn, 0) if is_dir else r.get("size", 0)
            children.append({
                "name": r.get("name", ""),
                "full_path": path_map.get(rn, "") if rn is not None else "",
                "is_dir": is_dir,
                "size": size,
                "created": r.get("created", 0.0),
                "modified": r.get("modified", 0.0),
                "accessed": r.get("accessed", 0.0),
            })

    children.sort(key=lambda x: x["size"], reverse=True)
    
    total_size = fsizes.get(target_rn, 0) if target_rn in fsizes else sum(c["size"] for c in children)
    target_path = path_map.get(target_rn, drive_letter.upper() + ":\\")

    return {
        "path": target_path,
        "total_size": total_size,
        "children": children[:5000]
    }
