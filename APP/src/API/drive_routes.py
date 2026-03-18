from flask import Blueprint, request, jsonify, send_file
from utils.drive_manager import create_drive, add_file, add_folder, get_drive_config, delete_item, rename_item, paste_items, open_item, get_drive_tree, delete_drive, move_drive_contents, rename_drive_config
from utils.mft_scan import scan_drive, search_volume, get_volume_stats, list_directory_mft, invalidate_cache, build_path_map
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


@drive_bp.route('/rename-drive', methods=['POST'])
def rename_drive_route():
    """Update the display name of a virtual drive (only updates config, not folder name)."""
    data = request.json or {}
    drive_path = data.get('path')
    new_name   = data.get('newName')
    if not drive_path or not new_name:
        return jsonify({"error": "path and newName required"}), 400
    try:
        rename_drive_config(drive_path, new_name)
        return jsonify({"success": True})
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


@drive_bp.route('/search', methods=['GET'])
def search_drive_files():
    """
    Recursively search for files/folders whose names contain `query`
    anywhere inside `drivePath` (case-insensitive).
    Returns the same file shape as /list for easy reuse in the frontend.
    """
    drive_path = request.args.get('drivePath')
    query      = (request.args.get('query') or '').strip().lower()
    if not drive_path or not os.path.isdir(drive_path):
        return jsonify({"error": "Invalid drivePath"}), 400
    if not query:
        return jsonify({"results": []}), 200

    results = []
    CONFIG_NAME = '.drive_config.json'
    MAX_RESULTS  = 500  # safety cap

    def _walk(folder: str) -> None:
        if len(results) >= MAX_RESULTS:
            return
        try:
            with os.scandir(folder) as it:
                for entry in it:
                    if entry.name == CONFIG_NAME:
                        continue
                    try:
                        st = entry.stat()
                    except OSError:
                        continue
                    if query in entry.name.lower():
                        results.append({
                            "name":     entry.name,
                            "is_dir":   entry.is_dir(),
                            "path":     entry.path,
                            "size":     st.st_size,
                            "created":  st.st_ctime,
                            "modified": st.st_mtime,
                            "accessed": st.st_atime,
                            "parent":   folder,
                        })
                    if entry.is_dir():
                        _walk(entry.path)
                    if len(results) >= MAX_RESULTS:
                        return
        except (PermissionError, OSError):
            pass

    _walk(drive_path)
    return jsonify({"results": results, "truncated": len(results) >= MAX_RESULTS})


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
    """Return the top-N largest files on a volume using the MFT cache."""
    drive_letter = request.args.get('drive', 'C')
    limit        = int(request.args.get('limit', 200))
    try:
        # Use volume stats which leverages the cache
        stats = get_volume_stats(drive_letter)
        if 'error' in stats:
            return jsonify({"error": stats['error']}), 500
        return jsonify({
            "largest_files":       stats["largest_files"][:limit],
            "total_files":         stats["total_files"],
            "total_dirs":          stats["total_dirs"],
            "total_size":          stats["total_size"],
            "extensions_by_count": stats["extensions_by_count"],
            "extensions_by_size":  stats["extensions_by_size"],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_bp.route('/mft-search', methods=['GET'])
def mft_search():
    """
    Fast MFT-based filename search across an entire NTFS volume.
    GET /api/drive/mft-search?drive=C&q=searchterm&limit=200&dirs_only=0&files_only=0
    Returns: [{name, full_path, is_dir, size, created, modified, accessed}]
    """
    drive  = request.args.get('drive', 'C')
    query  = request.args.get('q', '').strip()
    limit  = int(request.args.get('limit', 200))
    if not query:
        return jsonify({"error": "Query parameter 'q' is required"}), 400

    is_dir_filter = None
    if request.args.get('dirs_only') == '1':
        is_dir_filter = True
    elif request.args.get('files_only') == '1':
        is_dir_filter = False

    try:
        results = search_volume(drive, query, is_dir_filter=is_dir_filter, max_results=limit)
        return jsonify({"results": results, "count": len(results)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_bp.route('/volume-stats', methods=['GET'])
def volume_stats():
    """
    Full MFT-derived statistics for a volume.
    GET /api/drive/volume-stats?drive=C
    Returns: total_files, total_dirs, total_size, extensions_by_count,
             extensions_by_size, largest_files
    """
    drive = request.args.get('drive', 'C')
    try:
        stats = get_volume_stats(drive)
        if 'error' in stats:
            return jsonify({"error": stats['error']}), 500
        return jsonify(stats)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_bp.route('/invalidate-mft-cache', methods=['POST'])
def invalidate_mft_cache():
    """Force the MFT cache to expire for a drive (or all drives)."""
    data   = request.json or {}
    letter = data.get('drive')   # optional; omit to clear all
    try:
        invalidate_cache(letter)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@drive_bp.route('/list', methods=['GET'])
def list_drive_files():
    """
    List the contents of a virtual drive directory.
    Tries MFT-based listing first (no per-entry syscalls); falls back to
    os.scandir when MFT data is unavailable (non-NTFS, no admin rights, etc.).
    """
    path = request.args.get('path')
    if not path or not os.path.exists(path):
        return jsonify({"error": "Invalid path"}), 400

    drive_letter = path[0].upper() if len(path) >= 2 else 'C'

    try:
        config = get_drive_config(path)

        # ── Try MFT listing (fast, no per-file syscalls) ──────────────────
        mft_children = list_directory_mft(drive_letter, path)
        if mft_children is not None:
            files = [
                {
                    "name":     e["name"],
                    "is_dir":   e["is_dir"],
                    "path":     e["full_path"] if e["full_path"] else os.path.join(path, e["name"]),
                    "size":     e["size"],
                    "created":  e["created"],
                    "modified": e["modified"],
                    "accessed": e["accessed"],
                }
                for e in mft_children
                if e["name"] != ".drive_config.json"
            ]
            return jsonify({"files": files, "config": config, "source": "mft"})

        # ── Fallback: os.scandir (POSIX / non-NTFS / no admin) ────────────
        files = []
        for entry in os.scandir(path):
            if entry.name == ".drive_config.json":
                continue
            st = entry.stat()
            files.append({
                "name":     entry.name,
                "is_dir":   entry.is_dir(),
                "path":     entry.path,
                "size":     st.st_size,
                "created":  st.st_ctime,
                "modified": st.st_mtime,
                "accessed": st.st_atime,
            })
        return jsonify({"files": files, "config": config, "source": "scandir"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@drive_bp.route('/file', methods=['GET'])
def serve_file():
    path_arg = request.args.get('path')
    if not path_arg or not os.path.exists(path_arg):
        return jsonify({'error': 'File not found'}), 404
    return send_file(path_arg)
