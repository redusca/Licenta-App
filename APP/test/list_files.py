import ctypes
import struct
import sys
import os
import time
import csv
from ctypes import wintypes

# Check for Administrator privileges
def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

if not is_admin():
    # Re-run the program with admin rights
    ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
    sys.exit()

# Constants and Structures
GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
OPEN_EXISTING = 3
FILE_ATTRIBUTE_NORMAL = 0x80
FSCTL_GET_NTFS_VOLUME_DATA = 0x00090064

class NTFS_VOLUME_DATA_BUFFER(ctypes.Structure):
    _fields_ = [
        ("VolumeSerialNumber", wintypes.LARGE_INTEGER),
        ("NumberSectors", wintypes.LARGE_INTEGER),
        ("TotalClusters", wintypes.LARGE_INTEGER),
        ("FreeClusters", wintypes.LARGE_INTEGER),
        ("TotalReserved", wintypes.LARGE_INTEGER),
        ("BytesPerSector", wintypes.DWORD),
        ("BytesPerCluster", wintypes.DWORD),
        ("BytesPerFileRecordSegment", wintypes.DWORD),
        ("ClustersPerFileRecordSegment", wintypes.DWORD),
        ("MftValidDataLength", wintypes.LARGE_INTEGER),
        ("MftStartLcn", wintypes.LARGE_INTEGER),
        ("Mft2StartLcn", wintypes.LARGE_INTEGER),
        ("MftZoneStart", wintypes.LARGE_INTEGER),
        ("MftZoneEnd", wintypes.LARGE_INTEGER),
    ]

# MFT Attribute Types
ATTR_STANDARD_INFORMATION = 0x10
ATTR_ATTRIBUTE_LIST = 0x20
ATTR_FILE_NAME = 0x30
ATTR_OBJECT_ID = 0x40
ATTR_SECURITY_DESCRIPTOR = 0x50
ATTR_VOLUME_NAME = 0x60
ATTR_VOLUME_INFORMATION = 0x70
ATTR_DATA = 0x80
ATTR_INDEX_ROOT = 0x90
ATTR_INDEX_ALLOCATION = 0xA0
ATTR_BITMAP = 0xB0
ATTR_REPARSE_POINT = 0xC0
ATTR_EA_INFORMATION = 0xD0
ATTR_EA = 0xE0
ATTR_PROPERTY_SET = 0xF0
ATTR_LOGGED_UTILITY_STREAM = 0x100

def get_drive_handle(drive_letter):
    drive_path = f"\\\\.\\{drive_letter}:"
    handle = ctypes.windll.kernel32.CreateFileW(
        drive_path,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        None,
        OPEN_EXISTING,
        0,
        None
    )
    if handle == -1:
        raise ctypes.WinError(ctypes.get_last_error())
    return handle

def get_ntfs_volume_data(handle):
    buffer = NTFS_VOLUME_DATA_BUFFER()
    bytes_returned = wintypes.DWORD()
    result = ctypes.windll.kernel32.DeviceIoControl(
        handle,
        FSCTL_GET_NTFS_VOLUME_DATA,
        None,
        0,
        ctypes.byref(buffer),
        ctypes.sizeof(buffer),
        ctypes.byref(bytes_returned),
        None
    )
    if not result:
        raise ctypes.WinError(ctypes.get_last_error())
    return buffer

def parse_mft_record(record_bytes, record_size):
    # Basic validation (FILE signature)
    if record_bytes[:4] != b'FILE':
        return None

    # Parse MFT Header
    # Offset 0x14: Offset to first attribute (2 bytes, unsigned short)
    # Offset 0x16: Flags (2 bytes) - 0x01 = InUse, 0x02 = Directory
    try:
        first_attr_offset = struct.unpack_from('<H', record_bytes, 0x14)[0]
        flags = struct.unpack_from('<H', record_bytes, 0x16)[0]
    except struct.error:
        return None
    
    if not (flags & 0x01): # Not in use
        return None

    is_directory = bool(flags & 0x02)
    
    file_info = {
        'name': None,
        'size': 0,
        'is_dir': is_directory,
        'parent_ref': None
    }

    offset = first_attr_offset
    while offset < len(record_bytes):
        # Attribute Header
        # 0x00: Attribute Type (4 bytes)
        # 0x04: Length (4 bytes)
        
        if offset + 8 > len(record_bytes): break
        
        attr_type, attr_len = struct.unpack_from('<II', record_bytes, offset)
        
        if attr_type == 0xFFFFFFFF: # End marker
            break
        if attr_len == 0: 
            break
            
        non_resident = struct.unpack_from('<B', record_bytes, offset + 8)[0]
        
        # Parse $FILE_NAME (0x30)
        if attr_type == ATTR_FILE_NAME:
            # Locate content
            if non_resident:
                # Non-resident $FILE_NAME is rare/illegal for normal usage, skip logic for simplicity
                pass
            else:
                # Resident header
                # 0x10: Size of content
                # 0x14: Offset to content
                if offset + 0x14 + 2 <= len(record_bytes):
                    content_off = struct.unpack_from('<H', record_bytes, offset + 0x14)[0]
                    absolute_content_off = offset + content_off
                    
                    # $FILE_NAME structure
                    # 0x00: Parent Reference (8 bytes)
                    # 0x38: Namespace (1 byte) - We prefer Win32 (0) or DOS (2) but usually take largest name
                    # 0x40: Name Length (1 byte, chars)
                    # 0x42: Name (Variable)
                    
                    if absolute_content_off + 66 <= len(record_bytes):
                        parent_ref = struct.unpack_from('<Q', record_bytes, absolute_content_off)[0] & 0xFFFFFFFFFFFF # 48 bits usually
                        name_len = struct.unpack_from('<B', record_bytes, absolute_content_off + 64)[0]
                        namespace = struct.unpack_from('<B', record_bytes, absolute_content_off + 65)[0]
                        
                        if absolute_content_off + 66 + (name_len * 2) <= len(record_bytes):
                            raw_name = record_bytes[absolute_content_off + 66 : absolute_content_off + 66 + (name_len * 2)]
                            name = raw_name.decode('utf-16-le', errors='replace')
                            
                            # Only update name if it's currently None or if this is a Win32 name and we have something else
                            # Simple logic: take the last one or Win32 (namespace 3 usually includes posix/win32)
                            # Namespaces: 0=POSIX, 1=Win32, 2=DOS, 3=Win32&DOS
                            if file_info['name'] is None or namespace == 3 or namespace == 1:
                                file_info['name'] = name
                                file_info['parent_ref'] = parent_ref

        # Parse $DATA (0x80)
        elif attr_type == ATTR_DATA:
            # We only care about the unnamed data stream (main file content)
            # Check name length of attribute if possible (offset 0x09 in header if non-resident, or similar)
            # But strictly, assume the first $DATA is the main one or check for name length = 0
            
            # Simplified check for unnamed stream:
            # Resident: offset 0x09 is name length
            # Non-resident: offset 0x09 is name length
            if offset + 10 <= len(record_bytes):
                name_len = struct.unpack_from('<B', record_bytes, offset + 9)[0]
                
                if name_len == 0: # Unnamed stream
                    if non_resident:
                        # Non-resident header
                        # 0x30: Real Size (8 bytes)
                        if offset + 0x38 <= len(record_bytes):
                            real_size = struct.unpack_from('<Q', record_bytes, offset + 0x30)[0]
                            file_info['size'] = real_size
                    else:
                        # Resident header
                        # 0x10: Content Size (4 bytes)
                        if offset + 0x14 <= len(record_bytes):
                            content_size = struct.unpack_from('<I', record_bytes, offset + 0x10)[0]
                            file_info['size'] = content_size

        offset += attr_len

    return file_info

def read_mft(drive_letter='C'):
    try:
        handle = get_drive_handle(drive_letter)
        ntfs_data = get_ntfs_volume_data(handle)
    except Exception as e:
        print(f"Failed to access drive {drive_letter}: {e}")
        return []
    
    mft_start_lcn = ntfs_data.MftStartLcn
    bytes_per_cluster = ntfs_data.BytesPerCluster
    bytes_per_record = ntfs_data.BytesPerFileRecordSegment
    
    # Calculate MFT start offset in bytes
    mft_offset = mft_start_lcn * bytes_per_cluster
    
    print(f"Volume: {drive_letter}:")
    print(f"MFT Start Offset: {mft_offset}")
    print(f"Record Size: {bytes_per_record}")
    
    # Move file pointer to MFT start
    position = wintypes.LARGE_INTEGER(mft_offset)
    ctypes.windll.kernel32.SetFilePointerEx(handle, position, None, 0)
    
    files = []
    
    # Calculate total records based on MFT valid data length
    total_mft_records = ntfs_data.MftValidDataLength // bytes_per_record
    print(f"Total MFT Records: {total_mft_records}")
    
    # We will read in large chunks (e.g. 1MB)
    CHUNK_SIZE = 1024 * 1024  # 1 MB
    records_per_chunk = CHUNK_SIZE // bytes_per_record
    
    print("Reading MFT... (Press Ctrl+C to stop early)")
    
    # Use total records as limit, but add safety margin
    MAX_RECORDS = total_mft_records + 1000
    
    buffer = ctypes.create_string_buffer(CHUNK_SIZE)
    bytes_read = wintypes.DWORD()
    
    count = 0
    empty_streak = 0
    
    try:
        while count < MAX_RECORDS:
            if not ctypes.windll.kernel32.ReadFile(handle, buffer, CHUNK_SIZE, ctypes.byref(bytes_read), None):
                break
            
            if bytes_read.value == 0:
                break
                
            chunk = buffer.raw[:bytes_read.value]
            
            for i in range(0, len(chunk), bytes_per_record):
                record_data = chunk[i : i + bytes_per_record]
                if len(record_data) < bytes_per_record: break
                
                info = parse_mft_record(record_data, bytes_per_record)
                if info and info['name']:
                    files.append(info)
                    empty_streak = 0
                else:
                    empty_streak += 1
                
                count += 1
            
            if empty_streak > 50000: # Increase heuristic for large drives
                # We might have hit the valid data length end practically
                break
            
            # Progress Bar
            if count % 5000 == 0:
                percent = min(100.0, (count / total_mft_records) * 100.0)
                bar_length = 50
                filled_length = int(bar_length * count // total_mft_records)
                if filled_length > bar_length: filled_length = bar_length
                bar = '█' * filled_length + '-' * (bar_length - filled_length)
                print(f'\rProgress: |{bar}| {percent:.1f}% ({count}/{total_mft_records})', end='')
                
    except KeyboardInterrupt:
        print("\nScan interrupted by user.")
    finally:
        print() # New line after progress bar
        ctypes.windll.kernel32.CloseHandle(handle)
        
    return files

def main():
    drive = 'C'
    print(f"Starting High-Performance MFT Scan on {drive}: ...")
    start_time = time.time()
    
    # 1. Read Files
    all_files = read_mft(drive)
    
    # 2. Sort by Size (Descending)
    print(f"\nSorting {len(all_files)} files...")
    all_files.sort(key=lambda x: x['size'], reverse=True)
    
    # 3. Display Top 50
    print("\n" + "="*85)
    print(f"{'SIZE (MB)':<15} | {'TYPE':<10} | {'FILE NAME'}")
    print("="*85)
    
    top_50 = all_files[:50]
    for f in top_50:
        size_mb = f['size'] / (1024 * 1024)
        name = f['name']
        ext = os.path.splitext(name)[1].lower() if name else ""
        print(f"{size_mb:,.2f} MB".ljust(15) + f" | {ext:<10} | {name}")

    # 4. Generate CSV Statistics
    print("\nGenerating Statistics CSV...")
    type_counts = {}
    for f in all_files:
        name = f['name']
        if name:
            ext = os.path.splitext(name)[1].lower()
            if not ext: ext = "(no ext)"
            type_counts[ext] = type_counts.get(ext, 0) + 1
            
    try:
        csv_path = 'mft_scan_stats.csv'
        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['Extension', 'Count'])
            sorted_types = sorted(type_counts.items(), key=lambda item: item[1], reverse=True)
            for ext, count in sorted_types:
                writer.writerow([ext, count])
        print(f"Stats saved to {os.path.abspath(csv_path)}")
    except Exception as e:
        print(f"Error saving CSV: {e}")
        
    end_time = time.time()
    print(f"\nTotal Time: {end_time - start_time:.2f} seconds")

if __name__ == "__main__":
    main()
