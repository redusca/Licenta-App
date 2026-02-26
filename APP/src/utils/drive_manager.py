import os
import json
import shutil
import subprocess
import uuid

from config import APP_VERSION
from migrations import load_and_migrate, get_latest_schema_version

CONFIG_FILENAME = ".drive_config.json"

def create_drive(path, name, drive_type):
    """
    Creates a 'virtual drive' folder.
    path: Parent directory where drive will be created (e.g. C:/Users/User/Desktop)
    name: Name of the drive folder (e.g. MyVirtualDrive)
    drive_type: 'move' or 'shortcut' (default preference for adding files)
    """
    full_path = os.path.join(path, name)
    if not os.path.exists(full_path):
        os.makedirs(full_path)
    
    config = {
        "schema_version": get_latest_schema_version(),
        "serial": str(uuid.uuid4()),
        "name": name,
        "type": drive_type,
        "created_at": str(os.path.getctime(full_path)),
        "app_version_created": APP_VERSION,
    }
    
    config_path = os.path.join(full_path, CONFIG_FILENAME)
    
    # helper to hide file on windows
    with open(config_path, 'w') as f:
        json.dump(config, f)
    
    # Hide the config file
    subprocess.call(["attrib", "+h", config_path], shell=True)
    
    return full_path

def create_shortcut(target, shortcut_path):
    # Ensure shortcut_path ends in .lnk
    if not shortcut_path.lower().endswith('.lnk'):
        shortcut_path += '.lnk'
        
    # VBScript to create shortcut
    vbs_script = f"""
    Set oWS = WScript.CreateObject("WScript.Shell")
    Set oLink = oWS.CreateShortcut("{shortcut_path}")
    oLink.TargetPath = "{target}"
    oLink.Save
    """
    vbs_file = f"create_shortcut_{abs(hash(shortcut_path))}.vbs"
    try:
        with open(vbs_file, "w") as f:
            f.write(vbs_script)
        subprocess.call(["cscript", "//NoLogo", vbs_file], shell=True)
    finally:
        if os.path.exists(vbs_file):
            os.remove(vbs_file)

def add_file(drive_path, file_path, mode='shortcut'):
    filename = os.path.basename(file_path)
    dest_path = os.path.join(drive_path, filename)
    
    if mode == 'move':
        shutil.move(file_path, dest_path)
    else: # shortcut
        # Create shortcut to file
        # Name should be filename.lnk
        link_name = filename + ".lnk"
        link_path = os.path.join(drive_path, link_name)
        create_shortcut(file_path, link_path)

def add_folder(drive_path, folder_path, mode='shortcut'):
    folder_name = os.path.basename(folder_path)
    dest_folder = os.path.join(drive_path, folder_name)
    
    if mode == 'move':
        shutil.move(folder_path, dest_folder)
    else:
        # Recursive shortcut creation
        if not os.path.exists(dest_folder):
            os.makedirs(dest_folder)
            
        for root, dirs, files in os.walk(folder_path):
            # Calculate partial path relative to source root
            rel_path = os.path.relpath(root, folder_path)
            if rel_path == '.':
                target_dir = dest_folder
            else:
                target_dir = os.path.join(dest_folder, rel_path)
            
            if not os.path.exists(target_dir):
                os.makedirs(target_dir)
            
            for file in files:
                src_file = os.path.join(root, file)
                # Create shortcut in target dir
                link_name = file + ".lnk"
                link_path = os.path.join(target_dir, link_name)
                create_shortcut(src_file, link_path)

def get_drive_config(drive_path):
    """Load the drive config, auto-migrating to the latest schema if needed."""
    return load_and_migrate(drive_path, APP_VERSION)

def delete_item(item_path):
    if not os.path.exists(item_path):
        return False
    
    if os.path.isfile(item_path):
        os.remove(item_path)
    else:
        shutil.rmtree(item_path)
    return True

def rename_item(item_path, new_name):
    if not os.path.exists(item_path):
        raise FileNotFoundError("Item not found")
        
    dirname = os.path.dirname(item_path)
    new_path = os.path.join(dirname, new_name)
    os.rename(item_path, new_path)
    return new_path

def paste_items(source_paths, dest_dir, mode='copy'):
    # Mode: 'copy' or 'cut'
    # source_paths is list of absolute paths
    # dest_dir is absolute path
    
    if not os.path.exists(dest_dir):
        raise FileNotFoundError("Destination directory not found")
        
    for src in source_paths:
        if not os.path.exists(src):
            continue
            
        filename = os.path.basename(src)
        dst = os.path.join(dest_dir, filename)
        
        # Handle collision
        if os.path.exists(dst):
            base, ext = os.path.splitext(filename)
            counter = 1
            while os.path.exists(dst):
                dst = os.path.join(dest_dir, f"{base} ({counter}){ext}")
                counter += 1
                
        if mode == 'copy':
            if os.path.isdir(src):
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
        elif mode == 'cut':
            shutil.move(src, dst)

def open_item(path):
    if os.path.exists(path):
        os.startfile(path)
        return True
    return False

def move_drive_contents(source_drive_path: str, dest_path: str) -> dict:
    """
    Move every item inside *source_drive_path* (except the hidden config file)
    into *dest_path*.  If a file/folder with the same name already exists in
    dest_path a numeric suffix is added to avoid collisions.
    Returns a summary dict: {moved: [...], errors: [...]}.
    """
    if not os.path.isdir(source_drive_path):
        raise FileNotFoundError(f"Source drive not found: {source_drive_path}")
    os.makedirs(dest_path, exist_ok=True)

    moved, errors = [], []
    for entry in os.scandir(source_drive_path):
        if entry.name == CONFIG_FILENAME:
            continue
        dst = os.path.join(dest_path, entry.name)
        if os.path.exists(dst):
            base, ext = os.path.splitext(entry.name)
            counter = 1
            while os.path.exists(dst):
                dst = os.path.join(dest_path, f"{base} ({counter}){ext}")
                counter += 1
        try:
            shutil.move(entry.path, dst)
            moved.append(dst)
        except Exception as exc:
            errors.append({"path": entry.path, "error": str(exc)})
    return {"moved": moved, "errors": errors}


def get_drive_tree(drive_path: str, max_depth: int = 6) -> dict:
    """
    Build a recursive file/folder tree for the given drive path.
    Hidden config files are excluded from the output.
    """
    def _build(path: str, depth: int) -> dict | None:
        if depth > max_depth:
            return None
        name = os.path.basename(path)
        is_dir = os.path.isdir(path)
        node: dict = {"name": name, "path": path, "is_dir": is_dir, "children": []}
        if is_dir:
            try:
                for entry in sorted(os.scandir(path), key=lambda e: (not e.is_dir(), e.name.lower())):
                    if entry.name == CONFIG_FILENAME:
                        continue
                    child = _build(entry.path, depth + 1)
                    if child is not None:
                        node["children"].append(child)
            except (PermissionError, OSError):
                pass
        return node

    return _build(drive_path, 0)  # type: ignore[return-value]

def delete_drive(drive_path: str) -> bool:
    """
    Permanently delete the entire virtual drive folder and all its contents.
    Returns True if the folder existed and was removed.
    """
    if not os.path.exists(drive_path):
        return False
    shutil.rmtree(drive_path)
    return True
