import ctypes
import struct
import sys
import os
import time
from ctypes import wintypes

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

def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

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
        # raise ctypes.WinError(ctypes.get_last_error())
        # Return None instead of raising so checking code can handle it
        return None 
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
        return None
    return buffer

def parse_mft_record(record_bytes, record_size):
    if record_bytes[:4] != b'FILE':
        return None

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
        if offset + 8 > len(record_bytes): break
        
        attr_type, attr_len = struct.unpack_from('<II', record_bytes, offset)
        
        if attr_type == 0xFFFFFFFF: # End marker
            break
        if attr_len == 0: 
            break
            
        non_resident = struct.unpack_from('<B', record_bytes, offset + 8)[0]
        
        if attr_type == ATTR_FILE_NAME:
            if not non_resident:
                if offset + 0x14 + 2 <= len(record_bytes):
                    content_off = struct.unpack_from('<H', record_bytes, offset + 0x14)[0]
                    absolute_content_off = offset + content_off
                    
                    if absolute_content_off + 66 <= len(record_bytes):
                        parent_ref = struct.unpack_from('<Q', record_bytes, absolute_content_off)[0] & 0xFFFFFFFFFFFF 
                        name_len = struct.unpack_from('<B', record_bytes, absolute_content_off + 64)[0]
                        namespace = struct.unpack_from('<B', record_bytes, absolute_content_off + 65)[0]
                        
                        if absolute_content_off + 66 + (name_len * 2) <= len(record_bytes):
                            raw_name = record_bytes[absolute_content_off + 66 : absolute_content_off + 66 + (name_len * 2)]
                            name = raw_name.decode('utf-16-le', errors='replace')
                            
                            if file_info['name'] is None or namespace == 3 or namespace == 1:
                                file_info['name'] = name
                                file_info['parent_ref'] = parent_ref

        elif attr_type == ATTR_DATA:
            if offset + 10 <= len(record_bytes):
                name_len = struct.unpack_from('<B', record_bytes, offset + 9)[0]
                
                if name_len == 0: # Unnamed stream
                    if non_resident:
                        if offset + 0x38 <= len(record_bytes):
                            real_size = struct.unpack_from('<Q', record_bytes, offset + 0x30)[0]
                            file_info['size'] = real_size
                    else:
                        if offset + 0x14 <= len(record_bytes):
                            content_size = struct.unpack_from('<I', record_bytes, offset + 0x10)[0]
                            file_info['size'] = content_size

        offset += attr_len

    return file_info

def scan_drive(drive_letter='C'):
    if not is_admin():
        # Ideally this should be handled at the application level, ensuring the app runs as admin.
        # Returning empty list or error indicator would be appropriate.
        print(f"Warning: Not running as admin. MFT scan for {drive_letter} may fail.")

    handle = get_drive_handle(drive_letter)
    if not handle:
        print(f"Could not get handle for drive {drive_letter}")
        return []

    ntfs_data = get_ntfs_volume_data(handle)
    if not ntfs_data:
        ctypes.windll.kernel32.CloseHandle(handle)
        print(f"Could not get NTFS data for drive {drive_letter}")
        return []
    
    mft_start_lcn = ntfs_data.MftStartLcn
    bytes_per_cluster = ntfs_data.BytesPerCluster
    bytes_per_record = ntfs_data.BytesPerFileRecordSegment
    mft_offset = mft_start_lcn * bytes_per_cluster
    
    position = wintypes.LARGE_INTEGER(mft_offset)
    ctypes.windll.kernel32.SetFilePointerEx(handle, position, None, 0)
    
    files = []
    total_mft_records = ntfs_data.MftValidDataLength // bytes_per_record
    CHUNK_SIZE = 1024 * 1024 
    records_per_chunk = CHUNK_SIZE // bytes_per_record
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
            
            if empty_streak > 50000:
                break
                
    except Exception as e:
        print(f"Error scanning MFT: {e}")
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)
        
    return files
