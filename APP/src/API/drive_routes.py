from flask import Blueprint, request, jsonify
from utils.drive_manager import create_drive, add_file, add_folder, get_drive_config, delete_item, rename_item, paste_items, open_item, get_drive_tree, delete_drive, move_drive_contents
from utils.mft_scan import scan_drive
from utils.drives_registry import load_registry, save_registry
from migrations import migrate_all_known_drives
from config import APP_VERSION
import os

drive_bp = Blueprint('drive', __name__)

@drive_bp.route('/registry', methods=['GET'])
def get_registry():
    """Return the backend-persisted list of known drives."""
    try:
        drives = load_registry()
        return jsonify({"success": True, "drives": drives})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_bp.route('/registry', methods=['POST'])
def post_registry():
    """
    Overwrite the backend registry with the list provided by the frontend.
    Called every time the frontend mutates knownDrives.
    """
    data = request.json or {}
    drives = data.get('drives')
    if not isinstance(drives, list):
        return jsonify({"error": "'drives' must be a list"}), 400
    try:
        save_registry(drives)
        return jsonify({"success": True, "saved": len(drives)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500



def startup_migrate():
    """
    Called once on app startup by the frontend.
    Accepts a list of drive paths and upgrades every config that is behind
    the latest schema version (including legacy drives with no schema_version).
    """
    data = request.json or {}
    drive_paths = data.get('drivePaths', [])
    if not isinstance(drive_paths, list):
        return jsonify({"error": "drivePaths must be a list"}), 400
    try:
        results = migrate_all_known_drives(drive_paths, APP_VERSION)
        migrated = [r for r in results if r.get('status') == 'migrated']
        return jsonify({
            "success": True,
            "app_version": APP_VERSION,
            "total": len(results),
            "migrated": len(migrated),
            "results": results,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@drive_bp.route('/move-drive-contents', methods=['POST'])
def move_drive_contents_route():
    """Move all files out of a move-drive into another folder before deletion."""
    data = request.json or {}
    source = data.get('sourcePath')
    dest   = data.get('destPath')
    if not source or not dest:
        return jsonify({"error": "sourcePath and destPath required"}), 400
    try:
        result = move_drive_contents(source, dest)
        return jsonify({"success": True, **result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_bp.route('/tree', methods=['GET'])
def drive_tree():
    """Return a recursive file/folder tree for a virtual drive (used before deletion)."""
    path = request.args.get('path')
    if not path or not os.path.exists(path):
        return jsonify({"error": "Invalid path"}), 400
    try:
        tree = get_drive_tree(path)
        return jsonify({"tree": tree})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_bp.route('/delete-drive', methods=['POST'])
def delete_drive_route():
    """Permanently delete an entire virtual drive folder from disk."""
    data = request.json or {}
    drive_path = data.get('path')
    if not drive_path:
        return jsonify({"error": "Path required"}), 400
    try:
        deleted = delete_drive(drive_path)
        return jsonify({"success": True, "deleted": deleted})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_bp.route('/open', methods=['POST'])
def open_path():
    data = request.json
    item_path = data.get('path')
    if not item_path:
        return jsonify({"error": "Path required"}), 400
    try:
        open_item(item_path)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@drive_bp.route('/delete', methods=['POST'])
def delete_file():
    data = request.json
    item_path = data.get('path')
    if not item_path:
        return jsonify({"error": "Path required"}), 400
    try:
        delete_item(item_path)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@drive_bp.route('/rename', methods=['POST'])
def rename_file():
    data = request.json
    item_path = data.get('path')
    new_name = data.get('newName')
    if not item_path or not new_name:
        return jsonify({"error": "Path and newName required"}), 400
    try:
        new_path = rename_item(item_path, new_name)
        return jsonify({"success": True, "newPath": new_path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@drive_bp.route('/paste', methods=['POST'])
def paste():
    data = request.json
    sources = data.get('sources') # List of paths
    dest = data.get('destination')
    mode = data.get('mode', 'copy') # 'copy' or 'cut'
    if not sources or not dest:
        return jsonify({"error": "Sources and destination required"}), 400
    try:
        paste_items(sources, dest, mode)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@drive_bp.route('/create', methods=['POST'])
def create():
    data = request.json
    path = data.get('path')
    name = data.get('name')
    mode = data.get('mode', 'shortcut')
    
    if not path or not name:
        return jsonify({"error": "Path and name are required"}), 400
        
    try:
        drive_path = create_drive(path, name, mode)
        return jsonify({"success": True, "drivePath": drive_path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@drive_bp.route('/add', methods=['POST'])
def add_item():
    data = request.json
    drive_path = data.get('drivePath')
    item_path = data.get('itemPath')
    is_folder = data.get('isFolder', False)
    mode = data.get('mode') # Optional override
    
    if not drive_path or not item_path:
        return jsonify({"error": "drivePath and itemPath are required"}), 400
        
    # Get drive default mode if not specified
    if not mode:
        config = get_drive_config(drive_path)
        if config:
            mode = config.get('type', 'shortcut')
        else:
            mode = 'shortcut'
            
    try:
        if is_folder:
            add_folder(drive_path, item_path, mode)
        else:
            add_file(drive_path, item_path, mode)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@drive_bp.route('/scan-volume', methods=['GET'])
def scan_volume():
    drive_letter = request.args.get('drive', 'C')
    try:
        files = scan_drive(drive_letter)
        # files is list of dicts.
        # Sorting by size descending to match the 'Top 50' behavior if desired,
        # but the UI might want all. MFT scan returns ALL files. This can be millions.
        # Returing millions of items in JSON will crash everything.
        # Let's limit to 1000 for safety, as user didn't specify pagination requirement yet.
        files.sort(key=lambda x: x['size'], reverse=True)
        return jsonify(files[:1000])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@drive_bp.route('/list', methods=['GET'])
def list_drive_files():
    # Regular listdir for the virtual drive
    path = request.args.get('path')
    if not path or not os.path.exists(path):
        return jsonify({"error": "Invalid path"}), 400
        
    files = []
    try:
        config = get_drive_config(path)
        for entry in os.scandir(path):
            if entry.name == ".drive_config.json":
                continue
            files.append({
                "name": entry.name,
                "is_dir": entry.is_dir(),
                "path": entry.path,
                "size": entry.stat().st_size
            })
        return jsonify({"files": files, "config": config})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
