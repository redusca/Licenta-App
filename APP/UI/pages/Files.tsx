import React, { useState, useEffect } from 'react';
import { 
    Folder, 
    Search,
    HardDrive,
    Plus,
    File,
    Loader2,
    Trash,
    Edit2,
    Copy,
    Scissors,
    ChevronRight,
    ChevronLeft,
    Home,
    MoreVertical,
    LogOut,
    ExternalLink,
    FileText,
    Image,
    Music,
    Video,
    Code,
    Archive,
    FileCode,
    ChevronDown,
    AlertTriangle,
    MoveRight,
    X
} from 'lucide-react';

const API_URL = 'http://127.0.0.1:5000/api/drive';

// Type definition for Electron API
declare global {
    interface Window {
        electronAPI?: {
            selectDirectory: () => Promise<string | null>;
            selectFile: () => Promise<string | null>;
            onDeviceChange: (cb: (payload: { availableRoots: string[]; added: string[]; removed: string[] }) => void) => () => void;
            getAvailableRoots: () => Promise<string[]>;
        }
    }
}

interface FileItem {
    name: string;
    is_dir: boolean;
    path: string;
    size: number;
}

interface DriveConfig {
    path: string;
    name: string;
    type: 'shortcut' | 'move';
}

interface TreeNode {
    name: string;
    path: string;
    is_dir: boolean;
    children: TreeNode[];
}

export const Files: React.FC = () => {
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [currentDrive, setCurrentDrive] = useState<DriveConfig | null>(null);
    const [files, setFiles] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(false);

    // Device tracking
    const [availableRoots, setAvailableRoots] = useState<string[]>([]);
    const [ejectedError, setEjectedError] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    
    // Drive Management
    const [knownDrives, setKnownDrives] = useState<DriveConfig[]>([]);
    
    // Creation Wizard State
    const [isCreating, setIsCreating] = useState(false);
    const [newDrivePath, setNewDrivePath] = useState('');
    const [newDriveName, setNewDriveName] = useState('MyVirtualDrive');
    const [newDriveMode, setNewDriveMode] = useState<'shortcut' | 'move'>('shortcut');

    // Clipboard & Selection
    const [clipboard, setClipboard] = useState<{items: FileItem[], mode: 'copy' | 'cut'}>({ items: [], mode: 'copy' });
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

    // Rename Modal
    const [renamingItem, setRenamingItem] = useState<FileItem | null>(null);
    const [newName, setNewName] = useState('');

    // Context Menu
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: FileItem } | null>(null);
    
    // Add Menu
    const [showAddMenu, setShowAddMenu] = useState(false);

    // Delete Drive
    const [deletingDrive, setDeletingDrive] = useState<DriveConfig | null>(null);
    const [driveTree, setDriveTree] = useState<TreeNode | null>(null);
    const [loadingTree, setLoadingTree] = useState(false);
    // Pre-delete move options (for move-type drives)
    const [preDeleteMove, setPreDeleteMove] = useState(false);
    const [preDeleteDestType, setPreDeleteDestType] = useState<'drive' | 'folder'>('drive');
    const [preDeleteDestDrive, setPreDeleteDestDrive] = useState<DriveConfig | null>(null);
    const [preDeleteDestFolder, setPreDeleteDestFolder] = useState('');
    const [preDeleteMoving, setPreDeleteMoving] = useState(false);

    // Move To
    const [movingItems, setMovingItems] = useState<FileItem[]>([]);
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [moveDestType, setMoveDestType] = useState<'drive' | 'folder'>('drive');
    const [selectedDestDrive, setSelectedDestDrive] = useState<DriveConfig | null>(null);
    const [moveDestFolder, setMoveDestFolder] = useState('');

    // Drive Pagination
    const DRIVES_PER_PAGE = 6;
    const [drivePage, setDrivePage] = useState(0);

    // Initial Load
    useEffect(() => {
        loadKnownDrives();

        // Run startup migration on all known drives (once per session)
        const runStartupMigration = () => {
            const stored = localStorage.getItem('knownDrives');
            if (!stored) return;
            try {
                const drives: DriveConfig[] = JSON.parse(stored);
                if (drives.length === 0) return;
                const paths = drives.map(d => d.path);
                fetch('http://127.0.0.1:5000/api/drive/startup-migrate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ drivePaths: paths }),
                })
                .then(r => r.json())
                .then(data => {
                    if (data.migrated > 0) {
                        console.log(`[startup-migrate] Upgraded ${data.migrated}/${data.total} drive configs to latest schema.`);
                    }
                })
                .catch(e => console.warn('[startup-migrate] Could not reach backend:', e));
            } catch (e) { console.warn('[startup-migrate] Failed to parse known drives:', e); }
        };
        runStartupMigration();

        // Fetch initial drive roots
        if (window.electronAPI?.getAvailableRoots) {
            window.electronAPI.getAvailableRoots().then(roots => setAvailableRoots(roots));
        }

        // Subscribe to device change events
        const unsub = window.electronAPI?.onDeviceChange((payload) => {
            setAvailableRoots(payload.availableRoots);
            // If we're currently inside a drive whose root was removed, flag it
            setCurrentDrive(prev => {
                if (prev) {
                    const root = getDriveRoot(prev.path);
                    if (root && payload.removed.some(r => r.toLowerCase() === root.toLowerCase())) {
                        setEjectedError(true);
                    }
                }
                return prev;
            });
            // Also reload known drives list to reflect availability
            loadKnownDrives();
        });

        const handleKeyDown = (e: KeyboardEvent) => {
            if (document.activeElement?.tagName === 'INPUT') return;
            
            if (e.ctrlKey) {
                switch(e.key.toLowerCase()) {
                    case 'c': e.preventDefault(); copySelection(); break;
                    case 'x': e.preventDefault(); cutSelection(); break;
                    case 'v': e.preventDefault(); pasteFromClipboard(); break;
                }
            } else if (e.key === 'Delete') {
                deleteSelection();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            unsub?.();
        };
    }, [selectedItems, clipboard, currentPath]); // Depencies important for closures

    useEffect(() => {
        if (currentPath) {
            fetchDriveFiles(currentPath);
        }
    }, [currentPath]);

    const loadKnownDrives = async () => {
        const stored = localStorage.getItem('knownDrives');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setKnownDrives(parsed);
                return;
            } catch(e) { console.error(e) }
        }

        // localStorage is empty or corrupt — try to restore from backend
        try {
            const res = await fetch(`${API_URL}/registry`);
            const data = await res.json();
            if (data.drives && data.drives.length > 0) {
                console.log(`[registry] Restored ${data.drives.length} drive(s) from backend backup.`);
                localStorage.setItem('knownDrives', JSON.stringify(data.drives));
                setKnownDrives(data.drives);
            }
        } catch(e) {
            console.warn('[registry] Could not restore from backend:', e);
        }
    };

    const saveKnownDrives = (drives: DriveConfig[]) => {
        localStorage.setItem('knownDrives', JSON.stringify(drives));
        setKnownDrives(drives);
        // Keep backend in sync so it can serve as recovery if localStorage is lost
        fetch(`${API_URL}/registry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ drives }),
        }).catch(e => console.warn('[registry] Sync to backend failed:', e));
    };

    const selectDrive = async (drive: DriveConfig) => {
         setEjectedError(false);
         setLoading(true);
         try {
            const res = await fetch(`${API_URL}/list?path=${encodeURIComponent(drive.path)}`);
            const data = await res.json();
            if (data.config) {
                 const updated = { ...drive, name: data.config.name, type: data.config.type };
                 setCurrentDrive(updated);
                 setCurrentPath(drive.path);
            } else {
                 alert(`Drive ${drive.name} not found.`);
            }
         } catch(e) { console.error("Error loading drive", e); } finally { setLoading(false); }
    };

    const fetchDriveFiles = async (path: string) => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/list?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            if (data.files) {
                setFiles(data.files);
                setSelectedItems(new Set());
            }
        } catch (e) { console.error(e); } finally { setLoading(false); }
    };

    const handleCreateDrive = async () => {
        if (!newDrivePath || !newDriveName) return alert("Path and name required");
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: newDrivePath, name: newDriveName, mode: newDriveMode })
            });
            const data = await res.json();
            if (data.success && data.drivePath) {
                const newDrive = { path: data.drivePath, name: newDriveName, type: newDriveMode };
                saveKnownDrives([...knownDrives, newDrive]);
                selectDrive(newDrive);
                setIsCreating(false);
            } else {
                alert('Error: ' + data.error);
            }
        } catch (e) { alert('Error creating drive'); } finally { setLoading(false); }
    };

    // --- Actions ---
    const pickDirectory = async () => {
        if (window.electronAPI) {
             const path = await window.electronAPI.selectDirectory();
             if (path) setNewDrivePath(path);
        }
    };

    const pickFileToAdd = async () => {
        if (!window.electronAPI || !currentPath) return;
        const path = await window.electronAPI.selectFile();
        if (path) handleAddPath(path);
        setShowAddMenu(false);
    };
    
    const pickFolderToAdd = async () => {
        if (!window.electronAPI || !currentPath) return;
        const path = await window.electronAPI.selectDirectory();
        if (path) handleAddPath(path);
        setShowAddMenu(false);
    };

    const handleAddPath = async (pathToAdd: string) => {
         setLoading(true);
         try {
            const isFolder = pathToAdd.indexOf('.') === -1; 
            await fetch(`${API_URL}/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    drivePath: currentPath,
                    itemPath: pathToAdd,
                    isFolder: isFolder, 
                    mode: currentDrive?.type || 'shortcut'
                })
            });
            if (currentPath) fetchDriveFiles(currentPath);
         } catch(e) { alert(e); } finally { setLoading(false); }
    };

    const deleteItem = async (path: string) => {
        if (!confirm('Delete item?')) return;
        try {
            await fetch(`${API_URL}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
            if (currentPath) fetchDriveFiles(currentPath);
        } catch(e) { alert(e); }
    };

    const deleteSelection = async () => {
         if (selectedItems.size === 0) return;
         if (!confirm(`Delete ${selectedItems.size} items?`)) return;
         for (const path of Array.from(selectedItems)) {
             await fetch(`${API_URL}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
         }
         if (currentPath) fetchDriveFiles(currentPath);
         setSelectedItems(new Set());
    };

    const renameItem = async () => {
        if (!renamingItem || !newName) return;
        try {
            await fetch(`${API_URL}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: renamingItem.path, newName }) });
            if (currentPath) fetchDriveFiles(currentPath);
            setRenamingItem(null);
            setNewName('');
        } catch(e) { alert(e); }
    };
    
    const openItem = async (path: string) => {
        try {
            await fetch(`${API_URL}/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
        } catch(e) { console.error(e); }
    };

    // Delete Drive
    const startDeleteDrive = async (drive: DriveConfig) => {
        setDriveTree(null);
        setPreDeleteMove(false);
        setPreDeleteDestType('drive');
        setPreDeleteDestDrive(knownDrives.find(d => d.path !== drive.path) || null);
        setPreDeleteDestFolder('');
        setDeletingDrive(drive);
        if (drive.type === 'move') {
            setLoadingTree(true);
            try {
                const res = await fetch(`${API_URL}/tree?path=${encodeURIComponent(drive.path)}`);
                const data = await res.json();
                setDriveTree(data.tree || null);
            } catch (e) {
                setDriveTree(null);
            } finally {
                setLoadingTree(false);
            }
        }
    };

    const confirmDeleteDrive = async () => {
        if (!deletingDrive) return;
        // If user chose to relocate files first, do that before wiping the drive
        if (preDeleteMove && deletingDrive.type === 'move') {
            const dest = preDeleteDestType === 'drive' ? preDeleteDestDrive?.path : preDeleteDestFolder;
            if (!dest) { alert('Please select a destination for the files.'); return; }
            setPreDeleteMoving(true);
            try {
                const res = await fetch(`${API_URL}/move-drive-contents`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sourcePath: deletingDrive.path, destPath: dest })
                });
                const data = await res.json();
                if (!data.success) { alert('Move failed: ' + data.error); setPreDeleteMoving(false); return; }
                if (data.errors?.length) {
                    const ok = confirm(`${data.moved.length} item(s) moved, but ${data.errors.length} failed. Continue with deletion?`);
                    if (!ok) { setPreDeleteMoving(false); return; }
                }
            } catch (e) {
                alert('Move failed: ' + e);
                setPreDeleteMoving(false);
                return;
            } finally {
                setPreDeleteMoving(false);
            }
        }
        try {
            await fetch(`${API_URL}/delete-drive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: deletingDrive.path })
            });
            const next = knownDrives.filter(d => d.path !== deletingDrive.path);
            saveKnownDrives(next);
            if (currentDrive?.path === deletingDrive.path) {
                setCurrentDrive(null);
                setCurrentPath(null);
                setFiles([]);
            }
        } catch (e) {
            alert('Error deleting drive: ' + e);
        } finally {
            setDeletingDrive(null);
            setDriveTree(null);
            setPreDeleteMove(false);
        }
    };

    // Move To
    const startMoveItems = (items: FileItem[]) => {
        setMovingItems(items);
        const otherDrive = knownDrives.find(d => d.path !== currentDrive?.path);
        setSelectedDestDrive(otherDrive || null);
        setMoveDestFolder('');
        setMoveDestType('drive');
        setShowMoveModal(true);
    };

    const pickDriveDeleteDestFolder = async () => {
        if (!window.electronAPI) return;
        const path = await window.electronAPI.selectDirectory();
        if (path) setPreDeleteDestFolder(path);
    };

    const pickMoveDestFolder = async () => {
        if (!window.electronAPI) return;
        const path = await window.electronAPI.selectDirectory();
        if (path) setMoveDestFolder(path);
    };

    const confirmMoveItems = async () => {
        const dest = moveDestType === 'drive' ? selectedDestDrive?.path : moveDestFolder;
        if (!dest) return alert('Please select a destination');
        setLoading(true);
        try {
            await fetch(`${API_URL}/paste`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sources: movingItems.map(f => f.path), destination: dest, mode: 'cut' })
            });
            if (currentPath) fetchDriveFiles(currentPath);
            setSelectedItems(new Set());
        } catch (e) {
            alert('Move failed: ' + e);
        } finally {
            setLoading(false);
            setShowMoveModal(false);
            setMovingItems([]);
        }
    };

    // Clipboard Logic
    const copySelection = () => { if (selectedItems.size > 0) setClipboard({ items: files.filter(f => selectedItems.has(f.path)), mode: 'copy' }); };
    const cutSelection = () => { if (selectedItems.size > 0) setClipboard({ items: files.filter(f => selectedItems.has(f.path)), mode: 'cut' }); };
    const pasteFromClipboard = async () => {
         if (!currentPath || clipboard.items.length === 0) return;
         setLoading(true);
         try {
            const sources = clipboard.items.map(f => f.path);
            await fetch(`${API_URL}/paste`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources, destination: currentPath, mode: clipboard.mode }) });
            fetchDriveFiles(currentPath);
            if (clipboard.mode === 'cut') setClipboard({ items: [], mode: 'copy' });
         } catch(e) { alert(e); } finally { setLoading(false); }
    };

    // Helpers
    const getFileIcon = (filename: string) => {
        const ext = filename.split('.').pop()?.toLowerCase();
        switch(ext) {
            case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': return <Image className="w-5 h-5 text-purple-500" />;
            case 'mp3': case 'wav': case 'ogg': return <Music className="w-5 h-5 text-pink-500" />;
            case 'mp4': case 'mov': case 'avi': return <Video className="w-5 h-5 text-red-500" />;
            case 'pdf': case 'txt': case 'doc': case 'docx': return <FileText className="w-5 h-5 text-blue-500" />;
            case 'js': case 'ts': case 'py': case 'html': case 'css': return <FileCode className="w-5 h-5 text-green-500" />;
            case 'zip': case 'rar': case '7z': return <Archive className="w-5 h-5 text-orange-500" />;
            default: return <File className="w-5 h-5 text-slate-400" />;
        }
    };

    const getDisplayName = (filename: string) => {
        return filename.replace(/\.lnk$/i, '');
    };

    // Extract the root letter from any path e.g. "E:\foo" → "E:\\"
    const getDriveRoot = (p: string): string | null => {
        const m = p.match(/^([A-Za-z]:\\)/);
        return m ? m[1] : null;
    };

    // Returns true if the drive's root is currently accessible (or if no electron API)
    const isDriveAvailable = (drive: DriveConfig): boolean => {
        if (availableRoots.length === 0) return true; // not yet polled / no electron
        const root = getDriveRoot(drive.path);
        if (!root) return true; // network/UNC path — assume available
        return availableRoots.some(r => r.toLowerCase() === root.toLowerCase());
    };
    
    // Breadcrumbs
    const getBreadcrumbs = () => {
        if (!currentDrive || !currentPath) return [];
        const root = currentDrive.path;
        const rel = currentPath.substring(root.length).replace(/^[/\\]/, '').split(/[/\\]/).filter(Boolean);
        const crumbs = [{ name: currentDrive.name, path: root }];
        let build = root;
        for (const seg of rel) {
             build = build.endsWith('\\') || build.endsWith('/') ? build + seg : build + '\\' + seg;
             crumbs.push({ name: seg, path: build });
        }
        return crumbs;
    };
    
    const navigateTo = (path: string) => { setCurrentPath(path); setSearchQuery(''); };

    // --- TreeView (recursive, used in Delete Drive modal) ---
    const TreeView: React.FC<{ node: TreeNode; depth?: number }> = ({ node, depth = 0 }) => {
        const [open, setOpen] = useState(depth < 2);
        return (
            <div style={{ paddingLeft: depth * 14 }}>
                <div className="flex items-center gap-1 py-0.5 text-xs text-slate-600 dark:text-slate-300">
                    {node.is_dir ? (
                        <button onClick={() => setOpen(!open)} className="flex items-center gap-1 hover:text-blue-500">
                            {open ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
                            <Folder className="w-3.5 h-3.5 text-yellow-500 fill-current flex-shrink-0" />
                        </button>
                    ) : (
                        <span className="flex-shrink-0 ml-1"><File className="w-3 h-3 text-slate-400" /></span>
                    )}
                    <span className="truncate ml-1">{node.name}</span>
                </div>
                {node.is_dir && open && node.children?.map((child, i) => (
                    <TreeView key={i} node={child} depth={depth + 1} />
                ))}
            </div>
        );
    };

    // --- Modals (shared across all views) ---
    const DriveModals: React.FC = () => (
        <>
            {/* Delete Drive Modal */}
            {deletingDrive && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl w-[520px] max-h-[80vh] shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-start gap-4">
                            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                                <AlertTriangle className="w-5 h-5 text-red-600" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Delete Drive</h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    {deletingDrive.type === 'move'
                                        ? <><strong>{deletingDrive.name}</strong> is a <strong>Move drive</strong> — files live here physically. You can move them to safety before deleting, or permanently remove everything.</>
                                        : <><strong>{deletingDrive.name}</strong> contains shortcuts only. Shortcuts will be removed but original files remain safe.</>
                                    }
                                </p>
                            </div>
                            <button onClick={() => { setDeletingDrive(null); setDriveTree(null); setPreDeleteMove(false); }} className="text-slate-400 hover:text-slate-600 p-1 flex-shrink-0"><X className="w-4 h-4" /></button>
                        </div>
                        {deletingDrive.type === 'move' && (
                            <>
                                {/* File tree */}
                                <div className="overflow-y-auto max-h-48 p-4 border-b border-slate-100 dark:border-slate-800">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Files inside this drive:</p>
                                    {loadingTree
                                        ? <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
                                        : driveTree
                                            ? <div className="font-mono"><TreeView node={driveTree} depth={0} /></div>
                                            : <p className="text-sm text-slate-400">Could not load file tree.</p>
                                    }
                                </div>

                                {/* Relocate toggle */}
                                <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
                                    <label className="flex items-center gap-3 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={preDeleteMove}
                                            onChange={e => setPreDeleteMove(e.target.checked)}
                                            className="w-4 h-4 accent-blue-600 rounded"
                                        />
                                        <span className="text-sm font-medium">Move files to a safe location before deleting</span>
                                    </label>

                                    {preDeleteMove && (
                                        <div className="pl-7 space-y-3">
                                            {/* Destination type tabs */}
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => setPreDeleteDestType('drive')}
                                                    className={`p-2.5 border rounded-xl text-left text-xs transition-all ${preDeleteDestType === 'drive' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                                                >
                                                    <HardDrive className="w-3.5 h-3.5 mb-1 text-blue-500" />
                                                    <div className="font-semibold">Another Drive</div>
                                                    <div className="text-slate-500">Move into a virtual drive</div>
                                                </button>
                                                <button
                                                    onClick={() => setPreDeleteDestType('folder')}
                                                    className={`p-2.5 border rounded-xl text-left text-xs transition-all ${preDeleteDestType === 'folder' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                                                >
                                                    <Folder className="w-3.5 h-3.5 mb-1 text-yellow-500" />
                                                    <div className="font-semibold">Folder on PC</div>
                                                    <div className="text-slate-500">Any local directory</div>
                                                </button>
                                            </div>

                                            {preDeleteDestType === 'drive' ? (
                                                knownDrives.filter(d => d.path !== deletingDrive.path).length === 0
                                                    ? <p className="text-xs text-slate-400 italic">No other drives available.</p>
                                                    : <div className="space-y-1 max-h-36 overflow-y-auto">
                                                        {knownDrives.filter(d => d.path !== deletingDrive.path).map((d, i) => (
                                                            <button key={i} onClick={() => setPreDeleteDestDrive(d)}
                                                                className={`w-full text-left p-2.5 rounded-lg border flex items-center gap-2.5 transition-all text-xs ${preDeleteDestDrive?.path === d.path ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                                                <HardDrive className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                                                                <div className="min-w-0">
                                                                    <div className="font-medium">{d.name}</div>
                                                                    <div className="text-slate-400 truncate">{d.path}</div>
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                            ) : (
                                                <div className="flex gap-2">
                                                    <input readOnly value={preDeleteDestFolder} placeholder="Choose a folder…"
                                                        className="flex-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono" />
                                                    <button onClick={pickDriveDeleteDestFolder}
                                                        className="px-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors">
                                                        <Folder className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                        <div className="p-4 flex justify-end gap-3">
                            <button onClick={() => { setDeletingDrive(null); setDriveTree(null); setPreDeleteMove(false); }} className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
                            <button onClick={confirmDeleteDrive} disabled={preDeleteMoving} className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors flex items-center gap-2">
                                {preDeleteMoving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {preDeleteMove ? 'Move & Delete Drive' : 'Delete Drive'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Move To Modal */}
            {showMoveModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl w-[480px] shadow-2xl border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold">
                                    Move {movingItems.length === 1 ? `"${getDisplayName(movingItems[0].name)}"` : `${movingItems.length} items`}
                                </h3>
                                <p className="text-sm text-slate-500 mt-0.5">Select a destination drive or folder on your PC.</p>
                            </div>
                            <button onClick={() => setShowMoveModal(false)} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <button onClick={() => setMoveDestType('drive')} className={`p-3 border rounded-xl text-left text-sm transition-all ${moveDestType === 'drive' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                    <HardDrive className="w-4 h-4 mb-1 text-blue-500" />
                                    <div className="font-semibold">Another Drive</div>
                                    <div className="text-xs text-slate-500">Move into a virtual drive</div>
                                </button>
                                <button onClick={() => setMoveDestType('folder')} className={`p-3 border rounded-xl text-left text-sm transition-all ${moveDestType === 'folder' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                    <Folder className="w-4 h-4 mb-1 text-yellow-500" />
                                    <div className="font-semibold">Folder on PC</div>
                                    <div className="text-xs text-slate-500">Move to any local directory</div>
                                </button>
                            </div>
                            {moveDestType === 'drive' ? (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium block">Select destination drive:</label>
                                    {knownDrives.filter(d => d.path !== currentDrive?.path).length === 0 ? (
                                        <p className="text-sm text-slate-400 italic">No other drives available. Create one first.</p>
                                    ) : (
                                        <div className="space-y-1 max-h-48 overflow-y-auto">
                                            {knownDrives.filter(d => d.path !== currentDrive?.path).map((d, i) => (
                                                <button key={i} onClick={() => setSelectedDestDrive(d)}
                                                    className={`w-full text-left p-3 rounded-lg border flex items-center gap-3 transition-all text-sm ${selectedDestDrive?.path === d.path ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                                    <HardDrive className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                                    <div className="min-w-0">
                                                        <div className="font-medium">{d.name}</div>
                                                        <div className="text-xs text-slate-400 truncate">{d.path}</div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium block">Destination folder:</label>
                                    <div className="flex gap-2">
                                        <input readOnly value={moveDestFolder} placeholder="Choose a folder…" className="flex-1 p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-mono opacity-80" />
                                        <button onClick={pickMoveDestFolder} className="px-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors">
                                            <Folder className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="px-6 pb-6 flex justify-end gap-3">
                            <button onClick={() => setShowMoveModal(false)} className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
                            <button onClick={confirmMoveItems} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors flex items-center gap-2">
                                <MoveRight className="w-4 h-4" /> Move Here
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );

    // --- Views ---
    if (isCreating) {
        return (
            <div className="max-w-xl mx-auto mt-10 bg-white dark:bg-slate-900 p-8 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl">
                <h2 className="text-xl font-bold mb-6">Create New Virtual Drive</h2>
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium mb-2">Location (Parent Folder)</label>
                        <div className="flex gap-2">
                             <input value={newDrivePath} readOnly className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-lg dark:bg-slate-800 dark:border-slate-700 font-mono text-sm opacity-50 cursor-not-allowed" />
                             <button onClick={pickDirectory} className="bg-slate-200 dark:bg-slate-700 px-4 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"><Folder className="w-4 h-4" /></button>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Select the folder where the drive folder will be created.</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-2">Drive Name</label>
                        <input value={newDriveName} onChange={(e) => setNewDriveName(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg dark:bg-slate-800 dark:border-slate-700" />
                    </div>
                     <div>
                        <label className="block text-sm font-medium mb-2">Default Operation Mode</label>
                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={() => setNewDriveMode('shortcut')} className={`p-4 border rounded-xl text-left transition-all ${newDriveMode === 'shortcut' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-800'}`} >
                                <h4 className="font-semibold mb-1 text-sm">Shortcut Mode</h4>
                                <p className="text-xs text-slate-500">Creates .lnk shortcuts. Safe for original files.</p>
                            </button>
                            <button onClick={() => setNewDriveMode('move')} className={`p-4 border rounded-xl text-left transition-all ${newDriveMode === 'move' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-800'}`} >
                                <h4 className="font-semibold mb-1 text-sm">Move Mode</h4>
                                <p className="text-xs text-slate-500">Moves actual files. Organizes original data.</p>
                            </button>
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                        <button onClick={() => setIsCreating(false)} className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors">Cancel</button>
                        <button onClick={handleCreateDrive} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-medium shadow-sm transition-all">Create Drive</button>
                    </div>
                </div>
            </div>
        );
    }
    
    if (!currentDrive) {
        if (knownDrives.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center h-[80vh] text-center space-y-8">
                    <div className="w-24 h-24 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-slate-800 dark:to-slate-800 rounded-2xl flex items-center justify-center text-blue-600 shadow-xl border border-white dark:border-slate-700">
                        <HardDrive className="w-12 h-12" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">Virtual Drives</h2>
                        <p className="text-slate-500 max-w-md mx-auto">Manage your files with smart virtual drives. Select a drive to get started or create a new one.</p>
                    </div>
                    <button onClick={() => setIsCreating(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-semibold text-lg hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center gap-2">
                        <Plus className="w-5 h-5" /> Create First Drive
                    </button>
                </div>
            );
        }

        const totalPages = Math.ceil(knownDrives.length / DRIVES_PER_PAGE);
        const safePage = Math.min(drivePage, totalPages - 1);
        const pageDrives = knownDrives.slice(safePage * DRIVES_PER_PAGE, (safePage + 1) * DRIVES_PER_PAGE);

        return (
            <>
            <div className="flex flex-col h-full">
                {/* Drive list */}
                <div className="space-y-3 py-4 px-1">
                    <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider pl-1 mb-4">Your Drives</div>
                    {pageDrives.map((d, i) => {
                        const available = isDriveAvailable(d);
                        return (
                        <div key={i} className="flex items-center gap-2">
                            <button onClick={() => available && selectDrive(d)} disabled={!available}
                                className={`flex-1 text-left p-4 bg-white dark:bg-slate-900 border rounded-xl transition-all group flex items-center gap-4
                                    ${ available
                                        ? 'border-slate-200 dark:border-slate-800 hover:border-blue-500 hover:shadow-md cursor-pointer'
                                        : 'border-slate-100 dark:border-slate-800/50 opacity-40 cursor-not-allowed' }`}>
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-transform ${ available ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 group-hover:scale-110' : 'bg-slate-100 dark:bg-slate-800 text-slate-400' }`}>
                                    <HardDrive className="w-5 h-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold">{d.name}</h3>
                                    <p className="text-xs text-slate-500 truncate">{d.path}</p>
                                    {!available && <p className="text-xs text-red-400 mt-0.5">Drive not connected</p>}
                                </div>
                                {available && <div className="ml-auto opacity-0 group-hover:opacity-100 text-blue-500"><ExternalLink className="w-4 h-4" /></div>}
                            </button>
                            <button
                                onClick={() => startDeleteDrive(d)}
                                className="p-2.5 flex-shrink-0 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors"
                                title="Delete drive"
                            >
                                <Trash className="w-4 h-4" />
                            </button>
                        </div>
                        );
                    })}
                </div>

                {/* Bottom bar: pagination corners + create button center */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
                    <button
                        onClick={() => setDrivePage(p => Math.max(0, p - 1))}
                        disabled={safePage === 0}
                        className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>

                    <div className="flex items-center gap-4">
                        <span className="text-sm text-slate-400">{safePage + 1} / {totalPages}</span>
                        <button onClick={() => setIsCreating(true)} className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-slate-500 hover:border-blue-500 hover:text-blue-500 transition-colors flex items-center gap-2 px-4 py-2 text-sm font-medium">
                            <Plus className="w-4 h-4" /> Create New Drive
                        </button>
                    </div>

                    <button
                        onClick={() => setDrivePage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={safePage >= totalPages - 1}
                        className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
            <DriveModals />
            </>
        );
    }

    const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

    // If the active drive was ejected, show a full overlay
    if (ejectedError) {
        return (
            <div className="flex flex-col items-center justify-center h-[80vh] text-center space-y-6">
                <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-2xl flex items-center justify-center text-red-500 shadow-lg border border-red-100 dark:border-red-800">
                    <HardDrive className="w-10 h-10" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold mb-2 text-red-600 dark:text-red-400">Drive Disconnected</h2>
                    <p className="text-slate-500 max-w-sm mx-auto">
                        The drive <span className="font-semibold text-slate-700 dark:text-slate-300">{currentDrive?.name}</span> is no longer connected.
                        Please reconnect the drive or return to the drives list.
                    </p>
                </div>
                <button
                    onClick={() => { setCurrentDrive(null); setEjectedError(false); }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-semibold transition-all hover:shadow-lg"
                >
                    Back to Drives
                </button>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col space-y-4" onClick={() => { setContextMenu(null); setShowAddMenu(false); }}>
            {/* Header Area */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm flex flex-col gap-4">
                {/* Top Row: Breadcrumbs & Drive Actions */}
                <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                     <div className="flex items-center gap-1 overflow-hidden flex-1 text-sm pl-2">
                         <Home className="w-4 h-4 text-slate-400 flex-shrink-0 cursor-pointer hover:text-blue-500" onClick={() => setCurrentDrive(null)} />
                         <span className="text-slate-300 mx-1">|</span>
                         {getBreadcrumbs().map((crumb, i, arr) => (
                             <div key={crumb.path} className="flex items-center gap-1 whitespace-nowrap">
                                 {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
                                 <button onClick={() => navigateTo(crumb.path)} className={`hover:bg-white dark:hover:bg-slate-700 px-2 py-0.5 rounded transition-all ${i === arr.length - 1 ? 'font-bold text-slate-900 dark:text-slate-100 shadow-sm bg-white dark:bg-slate-700' : 'text-slate-500'}`}>
                                     {crumb.name}
                                 </button>
                             </div>
                         ))}
                    </div>
                    <button onClick={() => setCurrentDrive(null)} className="p-2 text-slate-400 hover:text-red-500 transition-colors" title="Close Drive"><LogOut className="w-4 h-4" /></button>
                </div>

                {/* Second Row: Search & Add */}
                <div className="flex gap-4 items-center">
                    <div className="relative flex-1">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                         <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search current folder..." className="pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm w-full focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
                    </div>
                    
                    <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setShowAddMenu(!showAddMenu); }}
                            className="bg-blue-600 hover:bg-blue-700 active:scale-95 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-all"
                        >
                            <Plus className="w-4 h-4" /> Add <ChevronDown className="w-3 h-3 opacity-80" />
                        </button>
                        {showAddMenu && (
                            <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                <button onClick={pickFileToAdd} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-3 text-sm"><File className="w-4 h-4 text-slate-500" /> Upload File</button>
                                <button onClick={pickFolderToAdd} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-3 text-sm"><Folder className="w-4 h-4 text-slate-500" /> Upload Folder</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            {/* Content List */}
             {loading ? (
                 <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
            ) : (
                <div 
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex-1 overflow-hidden flex flex-col shadow-sm select-none"
                    onContextMenu={(e) => e.preventDefault()}
                >
                    <div className="overflow-y-auto flex-1 p-2">
                        {filteredFiles.map((file) => {
                             const isCut = clipboard.mode === 'cut' && clipboard.items.some(i => i.path === file.path);
                             return (
                                 <div 
                                    key={file.path}
                                    className={`flex items-center px-4 py-3 rounded-lg group cursor-pointer transition-all border border-transparent ${selectedItems.has(file.path) ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'} ${isCut ? 'opacity-50' : ''}`}
                                    onClick={(e) => {
                                        if (e.ctrlKey) {
                                            const next = new Set(selectedItems);
                                            if (next.has(file.path)) next.delete(file.path); else next.add(file.path);
                                            setSelectedItems(next);
                                        } else {
                                            setSelectedItems(new Set([file.path]));
                                        }
                                    }}
                                    onDoubleClick={() => {
                                        if (file.is_dir) navigateTo(file.path);
                                        else openItem(file.path);
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setSelectedItems(new Set([file.path]));
                                        setContextMenu({ x: e.clientX, y: e.clientY, item: file });
                                    }}
                                 >
                                    <div className="flex-1 flex items-center gap-3">
                                        {file.is_dir ? <Folder className="w-5 h-5 text-yellow-500 fill-current" /> : getFileIcon(file.name)}
                                        <span className={`text-sm ${selectedItems.has(file.path) ? 'font-semibold text-blue-700 dark:text-blue-300' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
                                            {getDisplayName(file.name)}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-400 group-hover:text-slate-500 w-24 text-right">{(file.size / 1024).toFixed(1)} KB</div>
                                    <button className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-all ml-4">
                                         <MoreVertical className="w-4 h-4 text-slate-500" onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY + 10, item: file }); }} />
                                    </button>
                                 </div>
                            );
                        })}
                        {filteredFiles.length === 0 && (
                            <div className="flex flex-col items-center justify-center p-12 text-slate-400 opacity-60">
                                <Folder className="w-12 h-12 mb-2" />
                                <p className="text-sm">Folder is empty</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Context Menu */}
            {contextMenu && (
                <div 
                    className="fixed z-50 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-xl rounded-lg w-52 py-1.5 text-sm animate-in fade-in zoom-in-95 duration-100"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()} 
                >
                    <div className="px-3 py-2 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800 mb-1 truncate tracking-wider">
                        {getDisplayName(contextMenu.item.name)}
                    </div>
                    {!contextMenu.item.is_dir && (
                        <button className="w-full text-left px-4 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 flex items-center gap-3 transition-colors"
                            onClick={() => { openItem(contextMenu.item.path); setContextMenu(null); }}>
                            <ExternalLink className="w-4 h-4" /> Open
                        </button>
                    )}
                    {contextMenu.item.is_dir && (
                        <button className="w-full text-left px-4 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 flex items-center gap-3 transition-colors"
                            onClick={() => { navigateTo(contextMenu.item.path); setContextMenu(null); }}>
                            <Folder className="w-4 h-4" /> Open
                        </button>
                    )}
                    <button className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-3 transition-colors"
                        onClick={() => { setRenamingItem(contextMenu.item); setNewName(contextMenu.item.name); setContextMenu(null); }}>
                        <Edit2 className="w-4 h-4" /> Rename
                    </button>
                    <button className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-3 transition-colors"
                        onClick={() => { copySelection(); setContextMenu(null); }}>
                        <Copy className="w-4 h-4" /> Copy
                    </button>
                    <button className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-3 transition-colors"
                        onClick={() => { cutSelection(); setContextMenu(null); }}>
                        <Scissors className="w-4 h-4" /> Cut
                    </button>
                    <button className="w-full text-left px-4 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 flex items-center gap-3 transition-colors"
                        onClick={() => { startMoveItems(files.filter(f => selectedItems.has(f.path))); setContextMenu(null); }}>
                        <MoveRight className="w-4 h-4" /> Move to...
                    </button>
                    <div className="h-px bg-slate-100 dark:bg-slate-800 my-1"/>
                    <button className="w-full text-left px-4 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-3 transition-colors"
                        onClick={() => { deleteItem(contextMenu.item.path); setContextMenu(null); }}>
                        <Trash className="w-4 h-4" /> Delete
                    </button>
                </div>
            )}

            {/* Rename Modal */}
            {renamingItem && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl w-96 shadow-2xl border border-slate-200 dark:border-slate-800 scale-100 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold mb-4">Rename Item</h3>
                        <input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full p-3 border border-slate-200 dark:border-slate-700 rounded-lg mb-4 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all" autoFocus onKeyDown={(e) => e.key === 'Enter' && renameItem()} />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setRenamingItem(null)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">Cancel</button>
                            <button onClick={renameItem} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-colors">Rename</button>
                        </div>
                    </div>
                </div>
            )}

            <DriveModals />
        </div>
    );
};
