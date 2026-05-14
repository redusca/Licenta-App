import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
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
    Archive,
    FileCode,
    ChevronDown,
    AlertTriangle,
    MoveRight,
    X,
    LayoutGrid,
    List,
    Filter,
    BarChart2,
    RefreshCw,
} from 'lucide-react';
import { MediaPreviewModal } from '../components/MediaPreviewModal';

// ─── file-type helpers ────────────────────────────────────────────────────────
const IMAGE_EXTS   = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','ico','tiff']);
const MEDIA_EXTS   = new Set(['mp4','mov','avi','mkv','mp3','wav','ogg','flac','aac','wma','wmv']);
const DOC_EXTS     = new Set(['pdf','txt','doc','docx','xls','xlsx','ppt','pptx','odt','rtf','md']);
const CODE_EXTS    = new Set(['js','ts','tsx','jsx','py','html','css','json','yaml','yml','sh','bat','cpp','c','h','cs','java','go','rs','php','rb','sql']);
const ARCHIVE_EXTS = new Set(['zip','rar','7z','tar','gz','bz2','xz']);

type ViewMode      = 'list' | 'grid';
type FileTypeFilter = 'all' | 'folder' | 'image' | 'doc' | 'media' | 'code' | 'archive' | 'shortcut';

function getExt(name: string): string {
    let basename = name.toLowerCase();
    if (basename.endsWith('.lnk')) {
        basename = basename.slice(0, -4);
    }
    return (basename.split('.').pop() ?? '');
}
function getTypeBucket(file: { is_dir: boolean; name: string }): FileTypeFilter {
    if (file.is_dir) return 'folder';
    const ext = getExt(file.name);
    if (IMAGE_EXTS.has(ext))   return 'image';
    if (MEDIA_EXTS.has(ext))   return 'media';
    if (DOC_EXTS.has(ext))     return 'doc';
    if (CODE_EXTS.has(ext))    return 'code';
    if (ARCHIVE_EXTS.has(ext)) return 'archive';
    if (file.name.toLowerCase().endsWith('.lnk')) return 'shortcut';
    return 'all';
}
function fmtBytes(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

const API_URL = 'http://127.0.0.1:5000/api/drive';

// Type definition for Electron API
declare global {
    interface Window {
        electronAPI?: {
            selectDirectory: () => Promise<string | null>;
            selectFile: () => Promise<string | null>;
            selectFiles: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string[]>;
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
    created?: number;   // Unix timestamp
    modified?: number;  // Unix timestamp
    accessed?: number;  // Unix timestamp
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
    const location = useLocation();
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [currentDrive, setCurrentDrive] = useState<DriveConfig | null>(null);
    const [files, setFiles] = useState<FileItem[]>([]);
    const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
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
    const lastClickedIdxRef = useRef<number | null>(null);

    // Rename file/folder Modal
    const [renamingItem, setRenamingItem] = useState<FileItem | null>(null);
    const [newName, setNewName] = useState('');

    // Drive Rename Modal
    const [renamingDrive, setRenamingDrive] = useState<DriveConfig | null>(null);
    const [driveRenameValue, setDriveRenameValue] = useState('');
    const [driveRenameLoading, setDriveRenameLoading] = useState(false);

    // View, Filter, Stats
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all');
    const [showStats, setShowStats] = useState(false);

    // Deep search (search across ALL folders in the drive)
    const [deepSearch, setDeepSearch] = useState(false);
    const [deepQuery, setDeepQuery] = useState('');
    const [deepResults, setDeepResults] = useState<(FileItem & { parent?: string })[]>([]);
    const [deepLoading, setDeepLoading] = useState(false);
    const [deepTruncated, setDeepTruncated] = useState(false);
    const deepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Drag-and-drop
    const [isDragOver, setIsDragOver] = useState(false);

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

    // Sort
    const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    // Move To
    const [movingItems, setMovingItems] = useState<FileItem[]>([]);
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [moveDestType, setMoveDestType] = useState<'drive' | 'folder'>('drive');
    const [selectedDestDrive, setSelectedDestDrive] = useState<DriveConfig | null>(null);
    const [moveDestFolder, setMoveDestFolder] = useState('');

    // Drive Pagination
    const DRIVES_PER_PAGE = 6;
    const [drivePage, setDrivePage] = useState(0);

    // Tool-drive filter & pagination
    const TOOL_DRIVES_PER_PAGE = 6;
    const [toolDrivePage, setToolDrivePage] = useState(0);
    const [driveFilter, setDriveFilter] = useState<'all' | 'tool'>('all');
    const [driveTypeFilter, setDriveTypeFilter] = useState<'all' | 'shortcut' | 'move'>('all');
    const [toolDrives, setToolDrives] = useState<{ path: string; name: string; tool: string }[]>([]);

    // Initial Load
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const urlPath = params.get('path');
        if (urlPath && urlPath !== currentPath) {
            // Find existing drive covering this path or assume it's a drive root
            // For tool drives, we can create a temporary config
            const name = urlPath.split(/[/\\]/).pop() || 'Drive';
            setCurrentDrive({ path: urlPath, name, type: 'move' }); // Assume move is safer default for folders
            setCurrentPath(urlPath);
        }

        loadKnownDrives();
        loadToolDrives();

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
                    case 'a': e.preventDefault(); setSelectedItems(new Set(files.map(f => f.path))); break;
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
    }, [selectedItems, clipboard, currentPath, files]); // Depencies important for closures

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

    const loadToolDrives = async () => {
        try {
            const res = await fetch('http://127.0.0.1:5000/api/tools/created-drives');
            const data = await res.json();
            setToolDrives(Array.isArray(data.drives) ? data.drives : []);
        } catch {
            // backend not reachable yet
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

    // ── Drive rename ──
    const startRenameDrive = (drive: DriveConfig) => {
        setRenamingDrive(drive);
        setDriveRenameValue(drive.name);
    };

    const confirmRenameDrive = async () => {
        if (!renamingDrive || !driveRenameValue.trim()) return;
        setDriveRenameLoading(true);
        try {
            const res = await fetch(`${API_URL}/rename-drive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: renamingDrive.path, newName: driveRenameValue.trim() })
            });
            const data = await res.json();
            if (data.success) {
                const updated = knownDrives.map(d =>
                    d.path === renamingDrive.path ? { ...d, name: driveRenameValue.trim() } : d
                );
                saveKnownDrives(updated);
                if (currentDrive?.path === renamingDrive.path)
                    setCurrentDrive(prev => prev ? { ...prev, name: driveRenameValue.trim() } : prev);
                setRenamingDrive(null);
            } else {
                alert('Rename failed: ' + data.error);
            }
        } catch(e) { alert('Rename failed: ' + e); } finally { setDriveRenameLoading(false); }
    };

    // ── Drag-and-drop handlers ──
    const handleDragOver = (e: React.DragEvent) => {
        if (!currentPath) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = currentDrive?.type === 'move' ? 'move' : 'link';
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
            setIsDragOver(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (!currentPath) return;
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length === 0) return;
        setLoading(true);
        try {
            for (const f of droppedFiles) {
                const filePath = (f as any).path as string; // Electron exposes real FS path
                if (!filePath) continue;
                // Electron sets type='' and size=0 for directories
                const isFolder = f.type === '' && f.size === 0;
                await fetch(`${API_URL}/add`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ drivePath: currentPath, itemPath: filePath, isFolder, mode: currentDrive?.type || 'shortcut' })
                });
            }
            fetchDriveFiles(currentPath);
        } catch(e) { alert('Drop failed: ' + e); } finally { setLoading(false); }
    };

    // ── Shift+click / Ctrl+click selection ──
    const handleItemClick = (e: React.MouseEvent, file: FileItem, displayedIdx: number) => {
        if (e.shiftKey && lastClickedIdxRef.current !== null) {
            const lo = Math.min(lastClickedIdxRef.current, displayedIdx);
            const hi = Math.max(lastClickedIdxRef.current, displayedIdx);
            const rangeKeys = sortedFilesDerived.slice(lo, hi + 1).map(f => f.path);
            setSelectedItems(prev => {
                const next = e.ctrlKey ? new Set(prev) : new Set<string>();
                rangeKeys.forEach(k => next.add(k));
                return next;
            });
        } else if (e.ctrlKey) {
            setSelectedItems(prev => {
                const next = new Set(prev);
                if (next.has(file.path)) next.delete(file.path); else next.add(file.path);
                return next;
            });
            lastClickedIdxRef.current = displayedIdx;
        } else {
            setSelectedItems(new Set([file.path]));
            lastClickedIdxRef.current = displayedIdx;
        }
    };
    // forward ref for sortedFiles used by handleItemClick above
    let sortedFilesDerived: FileItem[] = [];

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
        if (path) handleAddPath(path, false);
        setShowAddMenu(false);
    };
    
    const pickFolderToAdd = async () => {
        if (!window.electronAPI || !currentPath) return;
        const path = await window.electronAPI.selectDirectory();
        if (path) handleAddPath(path, true);
        setShowAddMenu(false);
    };

    // isFolder is now passed explicitly by the caller so we don't try to
    // guess from the path string (which is unreliable — e.g. john.doe\folder).
    const handleAddPath = async (pathToAdd: string, isFolder: boolean) => {
         setLoading(true);
         try {
            await fetch(`${API_URL}/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    drivePath: currentPath,
                    itemPath: pathToAdd,
                    isFolder,
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
    const getFileIcon = (filename: string, size: 'sm' | 'lg' = 'sm') => {
        const cls = size === 'lg' ? 'w-10 h-10' : 'w-5 h-5';
        const ext = getExt(filename);
        if (IMAGE_EXTS.has(ext))   return <Image className={`${cls} text-purple-500`} />;
        if (ARCHIVE_EXTS.has(ext)) return <Archive className={`${cls} text-orange-500`} />;
        if (MEDIA_EXTS.has(ext)) {
            if (['mp3','wav','ogg','flac','aac','wma'].includes(ext)) return <Music className={`${cls} text-pink-500`} />;
            return <Video className={`${cls} text-red-500`} />;
        }
        if (DOC_EXTS.has(ext))  return <FileText className={`${cls} text-blue-500`} />;
        if (CODE_EXTS.has(ext)) return <FileCode className={`${cls} text-green-500`} />;
        return <File className={`${cls} text-slate-400`} />;
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
    
    const navigateTo = (path: string) => {
        setCurrentPath(path);
        setSearchQuery('');
        setSelectedItems(new Set());
        lastClickedIdxRef.current = null;
        // Exit deep search when navigating into a folder
        setDeepSearch(false);
        setDeepQuery('');
        setDeepResults([]);
    };

    // ── Deep search runner ───────────────────────────────────────────────
    const runDeepSearch = (q: string) => {
        if (deepTimerRef.current) clearTimeout(deepTimerRef.current);
        if (!q.trim() || !currentDrive) { setDeepResults([]); setDeepLoading(false); return; }
        setDeepLoading(true);
        deepTimerRef.current = setTimeout(async () => {
            try {
                const res = await fetch(
                    `${API_URL}/search?drivePath=${encodeURIComponent(currentDrive.path)}&query=${encodeURIComponent(q.trim())}`
                );
                const data = await res.json();
                setDeepResults(data.results || []);
                setDeepTruncated(!!data.truncated);
            } catch {
                setDeepResults([]);
            } finally {
                setDeepLoading(false);
            }
        }, 350);
    };

    const toggleDeepSearch = () => {
        if (deepSearch) {
            setDeepSearch(false);
            setDeepQuery('');
            setDeepResults([]);
        } else {
            setDeepSearch(true);
        }
    };

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
            {/* Drive Rename Modal */}
            {renamingDrive && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl w-96 shadow-2xl border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-bold mb-1">Rename Drive</h3>
                        <p className="text-sm text-slate-500 mb-4">Change the display name of <span className="font-medium text-slate-700 dark:text-slate-300">{renamingDrive.name}</span>.</p>
                        <input
                            value={driveRenameValue}
                            onChange={e => setDriveRenameValue(e.target.value)}
                            className="w-full p-3 border border-slate-200 dark:border-slate-700 rounded-lg mb-4 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && confirmRenameDrive()}
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setRenamingDrive(null)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">Cancel</button>
                            <button onClick={confirmRenameDrive} disabled={driveRenameLoading || !driveRenameValue.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 shadow-sm transition-colors flex items-center gap-2">
                                {driveRenameLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                Rename
                            </button>
                        </div>
                    </div>
                </div>
            )}

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

        const filteredDrives = knownDrives.filter(d => driveTypeFilter === 'all' || d.type === driveTypeFilter);
        const totalPages = Math.ceil(filteredDrives.length / DRIVES_PER_PAGE);
        const safePage = Math.min(drivePage, totalPages - 1 >= 0 ? totalPages - 1 : 0);
        const pageDrives = filteredDrives.slice(safePage * DRIVES_PER_PAGE, (safePage + 1) * DRIVES_PER_PAGE);

        return (
            <>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: 'var(--page)' }}>
                {/* Hero */}
                <div style={{ padding: '40px 44px 28px', background: 'linear-gradient(180deg, var(--surface-2) 0%, transparent 100%)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, maxWidth: 1100 }}>
                        <div>
                            <h1 className="heading-display" style={{ margin: 0, fontSize: 38, lineHeight: 1.02 }}>
                                Your drives,<br/>all in one place.
                            </h1>
                            <p style={{ marginTop: 12, fontSize: 15, color: 'var(--muted)', maxWidth: 520, lineHeight: 1.5 }}>
                                Group folders from anywhere on your computer into virtual drives.
                                Open one to browse, drop files, and run tools on its contents.
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                            {toolDrives.length > 0 && (
                                <>
                                    <button
                                        onClick={() => setDriveFilter(driveFilter === 'tool' ? 'all' : 'tool')}
                                        className="btn btn-secondary"
                                        style={{ background: driveFilter === 'tool' ? 'var(--accent-soft)' : undefined, color: driveFilter === 'tool' ? 'var(--accent-ink)' : undefined }}
                                    >
                                        <Filter className="w-3.5 h-3.5" />
                                        {driveFilter === 'tool' ? 'All Drives' : 'Tool Drives'}
                                    </button>
                                </>
                            )}
                            <button onClick={() => { loadKnownDrives(); loadToolDrives(); }} className="btn btn-secondary">
                                <RefreshCw className="w-3.5 h-3.5" /> Refresh
                            </button>
                            <button onClick={() => setIsCreating(true)} className="btn btn-primary">
                                <Plus className="w-3.5 h-3.5" /> New drive
                            </button>
                        </div>
                    </div>
                    {/* Stats strip */}
                    <div style={{ display: 'flex', gap: 28, marginTop: 28, color: 'var(--muted)', fontSize: 12.5 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)', fontSize: 14, fontWeight: 500 }}>{knownDrives.length}</span>
                            <span>Drives</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)', fontSize: 14, fontWeight: 500 }}>{toolDrives.length}</span>
                            <span>Tool drives</span>
                        </div>
                    </div>
                </div>

                {/* Drive type filter */}
                {driveFilter === 'all' && (
                    <div style={{ padding: '0 44px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600, color: 'var(--faint)' }}>Filter</span>
                        {(['all', 'shortcut', 'move'] as const).map(t => (
                            <button key={t} onClick={() => setDriveTypeFilter(t)} style={{
                                padding: '5px 12px', borderRadius: 'var(--r-pill)', fontSize: 12.5, fontWeight: 500,
                                background: driveTypeFilter === t ? 'var(--ink)' : 'var(--surface)',
                                color: driveTypeFilter === t ? 'var(--page)' : 'var(--ink-2)',
                                border: '1px solid ' + (driveTypeFilter === t ? 'transparent' : 'var(--border)'),
                                transition: 'all .15s var(--ease)',
                            }}>
                                {t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}
                            </button>
                        ))}
                    </div>
                )}

                {/* Tool drives */}
                {driveFilter === 'tool' && (
                    <div style={{ padding: '0 44px 32px' }}>
                        {(() => {
                            const toolTotalPages = Math.ceil(toolDrives.length / TOOL_DRIVES_PER_PAGE);
                            const safeTdPage = Math.min(toolDrivePage, toolTotalPages - 1 >= 0 ? toolTotalPages - 1 : 0);
                            const pageToolDrives = toolDrives.slice(safeTdPage * TOOL_DRIVES_PER_PAGE, (safeTdPage + 1) * TOOL_DRIVES_PER_PAGE);
                            return (<>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600, color: 'var(--faint)' }}>
                                Tool Drives <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{toolDrives.length}</span>
                            </div>
                            {toolTotalPages > 1 && (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <button onClick={() => setToolDrivePage(p => Math.max(0, p - 1))} disabled={safeTdPage === 0} className="btn btn-ghost" style={{ padding: '6px 10px', opacity: safeTdPage === 0 ? 0.3 : 1 }}>
                                        <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{safeTdPage + 1}/{toolTotalPages}</span>
                                    <button onClick={() => setToolDrivePage(p => Math.min(toolTotalPages - 1, p + 1))} disabled={safeTdPage >= toolTotalPages - 1} className="btn btn-ghost" style={{ padding: '6px 10px', opacity: safeTdPage >= toolTotalPages - 1 ? 0.3 : 1 }}>
                                        <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                        {toolDrives.length === 0 ? (
                            <p style={{ fontSize: 13, color: 'var(--muted)' }}>No tool-created drives yet. Run a tool to see drives created automatically here.</p>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                                {pageToolDrives.map((td, i) => {
                                    const asDrive: DriveConfig = { path: td.path, name: td.name, type: 'move' };
                                    const available = isDriveAvailable(asDrive);
                                    return (
                                        <button key={i} onClick={() => available && selectDrive(asDrive)} disabled={!available}
                                            className="hover-card"
                                            style={{
                                                textAlign: 'left', padding: 16, borderRadius: 'var(--r-card)',
                                                background: 'var(--surface)', border: '1px solid var(--border)',
                                                display: 'flex', alignItems: 'center', gap: 14,
                                                opacity: available ? 1 : 0.5, cursor: available ? 'pointer' : 'not-allowed',
                                            }}>
                                            <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--c-sky-bg)', color: 'var(--c-sky)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <HardDrive className="w-5 h-5" />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{td.name}</div>
                                                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{td.path}</div>
                                                {!available && <div style={{ fontSize: 11, color: 'var(--c-clay)', marginTop: 2 }}>Drive not connected</div>}
                                            </div>
                                            <ChevronRight className="w-4 h-4" style={{ color: 'var(--faint)', flexShrink: 0 }} />
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        </>);
                        })()}
                    </div>
                )}

                {/* Regular drives grid */}
                {driveFilter === 'all' && (
                    <div style={{ padding: '0 44px 40px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600, color: 'var(--faint)' }}>
                                All drives <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{filteredDrives.length}</span>
                            </div>
                            {totalPages > 1 && (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <button onClick={() => setDrivePage(p => Math.max(0, p - 1))} disabled={safePage === 0} className="btn btn-ghost" style={{ padding: '6px 10px', opacity: safePage === 0 ? 0.3 : 1 }}>
                                        <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{safePage + 1}/{totalPages}</span>
                                    <button onClick={() => setDrivePage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1} className="btn btn-ghost" style={{ padding: '6px 10px', opacity: safePage >= totalPages - 1 ? 0.3 : 1 }}>
                                        <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                            {/* New drive card */}
                            <button onClick={() => setIsCreating(true)} className="hover-card"
                                style={{
                                    padding: 16, borderRadius: 'var(--r-card)',
                                    background: 'transparent',
                                    border: '1.5px dashed var(--border-2)',
                                    display: 'flex', alignItems: 'center', gap: 14,
                                    color: 'var(--muted)', textAlign: 'left',
                                }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent-ink)'; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
                            >
                                <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Plus className="w-5 h-5" />
                                </div>
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>New drive</div>
                                    <div style={{ fontSize: 11.5, marginTop: 2 }}>From a folder, or build from scratch</div>
                                </div>
                            </button>

                            {pageDrives.map((d, i) => {
                                const available = isDriveAvailable(d);
                                const accentColor = d.type === 'move' ? 'clay' : 'sky';
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'stretch', gap: 0, position: 'relative' }}>
                                        <button onClick={() => available && selectDrive(d)} disabled={!available}
                                            className="hover-card"
                                            style={{
                                                flex: 1, textAlign: 'left', padding: '14px 44px 14px 14px',
                                                borderRadius: 'var(--r-card)',
                                                background: 'var(--surface)', border: '1px solid var(--border)',
                                                display: 'flex', alignItems: 'center', gap: 14,
                                                opacity: available ? 1 : 0.5,
                                                cursor: available ? 'pointer' : 'not-allowed',
                                            }}>
                                            <div style={{ width: 42, height: 42, borderRadius: 11, background: `var(--c-${accentColor}-bg)`, color: `var(--c-${accentColor})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <HardDrive className="w-5 h-5" />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{d.name}</span>
                                                    <span className="pill" style={{ background: d.type === 'move' ? 'var(--c-sage-bg)' : 'var(--c-sky-bg)', color: d.type === 'move' ? 'var(--c-sage)' : 'var(--c-sky)', border: '1px solid transparent', padding: '2px 8px', fontSize: 11 }}>
                                                        {d.type === 'move' ? 'Move' : 'Shortcut'}
                                                    </span>
                                                    {!available && <span className="pill" style={{ background: 'var(--c-clay-bg)', color: 'var(--c-clay)', border: '1px solid transparent', padding: '2px 8px', fontSize: 11 }}>offline</span>}
                                                </div>
                                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                                                    {d.path.split(/[/\\]/).slice(-2).join('\\')}
                                                </div>
                                            </div>
                                        </button>
                                        {/* Action buttons overlay */}
                                        <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 4 }}>
                                            <button onClick={() => startRenameDrive(d)} title="Rename"
                                                style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', transition: 'all .15s var(--ease)' }}
                                                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
                                                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
                                            ><Edit2 className="w-3.5 h-3.5" /></button>
                                            <button onClick={() => startDeleteDrive(d)} title="Delete"
                                                style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', transition: 'all .15s var(--ease)' }}
                                                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-clay-bg)'; (e.currentTarget as HTMLElement).style.color = 'var(--c-clay)'; }}
                                                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
                                            ><Trash className="w-3.5 h-3.5" /></button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
            <DriveModals />
            </>
        );
    }

    const filteredFiles = files.filter(f => {
        if (!f.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        if (fileTypeFilter === 'all') return true;
        return getTypeBucket(f) === fileTypeFilter;
    });

    // ── Sort ──────────────────────────────────────────────────────────────
    const toggleSort = (col: 'name' | 'size' | 'modified') => {
        if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortBy(col); setSortDir('asc'); }
    };

    // eslint-disable-next-line prefer-const
    sortedFilesDerived = [...filteredFiles].sort((a, b) => {
        // Always show directories first
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        let cmp = 0;
        if (sortBy === 'name')     cmp = getDisplayName(a.name).localeCompare(getDisplayName(b.name));
        else if (sortBy === 'size') cmp = a.size - b.size;
        else if (sortBy === 'modified') cmp = (a.modified ?? 0) - (b.modified ?? 0);
        return sortDir === 'asc' ? cmp : -cmp;
    });
    const sortedFiles = sortedFilesDerived;

    const SortArrow = ({ col }: { col: string }) => {
        if (sortBy !== col) return <span className="text-slate-300 select-none"> ↕</span>;
        return <span className="text-blue-500 select-none">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>;
    };

    const fmtDate = (ts?: number) => {
        if (!ts || ts === 0) return '';
        const d = new Date(ts * 1000);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // Drive stats
    const totalSize  = files.reduce((s, f) => s + (f.is_dir ? 0 : f.size), 0);
    const fileCount  = files.filter(f => !f.is_dir).length;
    const folderCount = files.filter(f =>  f.is_dir).length;

    // Filter chips
    const filterChips: { label: string; value: FileTypeFilter; count: number }[] = ([
        { label: 'All',       value: 'all',      count: files.length },
        { label: 'Folders',   value: 'folder',   count: files.filter(f => getTypeBucket(f) === 'folder').length },
        { label: 'Images',    value: 'image',    count: files.filter(f => getTypeBucket(f) === 'image').length },
        { label: 'Docs',      value: 'doc',      count: files.filter(f => getTypeBucket(f) === 'doc').length },
        { label: 'Media',     value: 'media',    count: files.filter(f => getTypeBucket(f) === 'media').length },
        { label: 'Code',      value: 'code',     count: files.filter(f => getTypeBucket(f) === 'code').length },
        { label: 'Archives',  value: 'archive',  count: files.filter(f => getTypeBucket(f) === 'archive').length },
        { label: 'Shortcuts', value: 'shortcut', count: files.filter(f => getTypeBucket(f) === 'shortcut').length },
    ] as { label: string; value: FileTypeFilter; count: number }[]).filter(c => c.value === 'all' || c.count > 0);

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
                    onClick={() => { setCurrentDrive(null); setCurrentPath(null); setFiles([]); setEjectedError(false); }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-semibold transition-all hover:shadow-lg"
                >
                    Back to Drives
                </button>
            </div>
        );
    }

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--page)' }}
            onClick={() => { setContextMenu(null); setShowAddMenu(false); }}>

            {/* Drive header strip */}
            <div style={{ padding: '16px 24px 12px', borderBottom: '1px solid var(--border)', background: 'var(--page)', flexShrink: 0 }}>
                {/* Breadcrumbs + close */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <button
                        onClick={() => { setCurrentDrive(null); setCurrentPath(null); setFiles([]); }}
                        className="btn btn-ghost" style={{ padding: 8 }} title="Back to drives"
                    >
                        <Home className="w-4 h-4" />
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {getBreadcrumbs().map((crumb, i, arr) => (
                            <React.Fragment key={crumb.path}>
                                {i > 0 && <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--faint)' }} />}
                                <button
                                    onClick={() => navigateTo(crumb.path)}
                                    style={{
                                        padding: '4px 8px', borderRadius: 6, fontSize: 14,
                                        color: i === arr.length - 1 ? 'var(--ink)' : 'var(--muted)',
                                        fontWeight: i === arr.length - 1 ? 600 : 500,
                                    }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                >{crumb.name}</button>
                            </React.Fragment>
                        ))}
                    </div>
                    <div style={{ flex: 1 }} />
                    <span className="pill" style={{ background: currentDrive?.type === 'move' ? 'var(--c-sage-bg)' : 'var(--c-sky-bg)', color: currentDrive?.type === 'move' ? 'var(--c-sage)' : 'var(--c-sky)', border: '1px solid transparent', padding: '3px 10px' }}>
                        {currentDrive?.type === 'move' ? 'Move drive' : 'Shortcut drive'}
                    </span>
                    <button onClick={() => { setCurrentDrive(null); setCurrentPath(null); setFiles([]); }}
                        className="btn btn-ghost" style={{ padding: 8 }} title="Close drive">
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>

                {/* Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Search */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', background: 'var(--surface)', border: `1px solid ${deepSearch ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--r-control)', width: 280, transition: 'border-color .15s' }}>
                        <Search className="w-3.5 h-3.5" style={{ color: 'var(--muted)', flexShrink: 0 }} />
                        {deepSearch ? (
                            <input autoFocus value={deepQuery}
                                onChange={(e) => { setDeepQuery(e.target.value); runDeepSearch(e.target.value); }}
                                placeholder="Search all folders…"
                                style={{ border: 0, outline: 0, background: 'transparent', flex: 1, fontSize: 12.5, color: 'var(--ink)' }}
                            />
                        ) : (
                            <input value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search current folder…"
                                style={{ border: 0, outline: 0, background: 'transparent', flex: 1, fontSize: 12.5, color: 'var(--ink)' }}
                            />
                        )}
                        {deepSearch && deepQuery && (
                            <button onClick={() => { setDeepQuery(''); setDeepResults([]); }} style={{ color: 'var(--muted)' }}>
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    <button onClick={toggleDeepSearch} className="btn btn-ghost"
                        style={{ background: deepSearch ? 'var(--accent-soft)' : undefined, color: deepSearch ? 'var(--accent-ink)' : undefined }}>
                        <Search className="w-3.5 h-3.5" /> All Folders
                    </button>

                    {/* Type filters */}
                    <div style={{ display: 'flex', gap: 4, flex: 1, flexWrap: 'wrap' }}>
                        {filterChips.map(chip => (
                            <button key={chip.value} onClick={() => setFileTypeFilter(chip.value)}
                                style={{
                                    padding: '4px 10px', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 500,
                                    background: fileTypeFilter === chip.value ? 'var(--accent)' : 'var(--surface)',
                                    color: fileTypeFilter === chip.value ? 'var(--on-accent)' : 'var(--ink-2)',
                                    border: '1px solid ' + (fileTypeFilter === chip.value ? 'transparent' : 'var(--border)'),
                                    transition: 'all .15s var(--ease)',
                                }}>
                                {chip.label} <span style={{ opacity: 0.65, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{chip.count}</span>
                            </button>
                        ))}
                    </div>

                    {/* Stats toggle */}
                    <button onClick={() => setShowStats(s => !s)} className="btn btn-ghost"
                        style={{ padding: 8, background: showStats ? 'var(--accent-soft)' : undefined, color: showStats ? 'var(--accent-ink)' : undefined }}>
                        <BarChart2 className="w-4 h-4" />
                    </button>

                    {/* View toggle */}
                    <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-control)', padding: 3, gap: 2 }}>
                        <button onClick={() => setViewMode('list')} style={{ padding: '5px 9px', borderRadius: 7, display: 'flex', alignItems: 'center', background: viewMode === 'list' ? 'var(--accent-soft)' : 'transparent', color: viewMode === 'list' ? 'var(--accent-ink)' : 'var(--muted)' }}>
                            <List className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setViewMode('grid')} style={{ padding: '5px 9px', borderRadius: 7, display: 'flex', alignItems: 'center', background: viewMode === 'grid' ? 'var(--accent-soft)' : 'transparent', color: viewMode === 'grid' ? 'var(--accent-ink)' : 'var(--muted)' }}>
                            <LayoutGrid className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {/* Add */}
                    <div style={{ position: 'relative' }}>
                        <button onClick={(e) => { e.stopPropagation(); setShowAddMenu(!showAddMenu); }} className="btn btn-primary">
                            <Plus className="w-3.5 h-3.5" /> Add
                        </button>
                        {showAddMenu && (
                            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, width: 180, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-md)', overflow: 'hidden', zIndex: 20 }}>
                                <button onClick={pickFileToAdd} style={{ width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 13, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 10 }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                                    <File className="w-4 h-4" style={{ color: 'var(--muted)' }} /> Upload File
                                </button>
                                <button onClick={pickFolderToAdd} style={{ width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 13, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 10 }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                                    <Folder className="w-4 h-4" style={{ color: 'var(--muted)' }} /> Upload Folder
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Stats panel */}
                {showStats && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 12 }}>
                        {[
                            { label: 'Total Items', value: String(files.length) },
                            { label: 'Files', value: String(fileCount) },
                            { label: 'Folders', value: String(folderCount) },
                            { label: 'Total Size', value: fmtBytes(totalSize) },
                        ].map(s => (
                            <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-control)', padding: '10px 14px', textAlign: 'center' }}>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>{s.value}</div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{s.label}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* File content area */}
            {deepSearch ? (
                /* ── Deep search results ── */
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
                    {/* Header bar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        <Search className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                        <span style={{ color: 'var(--accent-ink)' }}>Search across all folders</span>
                        {deepLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)', marginLeft: 4 }} />}
                        {!deepLoading && deepQuery && (
                            <span style={{ marginLeft: 'auto', fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>
                                {deepResults.length} result{deepResults.length !== 1 ? 's' : ''}
                                {deepTruncated ? ' (showing first 500)' : ''}
                            </span>
                        )}
                    </div>
                    <div className="overflow-y-auto flex-1 p-2">
                        {!deepQuery && (
                            <div className="flex flex-col items-center justify-center p-12 text-slate-400 opacity-60">
                                <Search className="w-10 h-10 mb-2" />
                                <p className="text-sm">Type to search across all folders</p>
                            </div>
                        )}
                        {deepQuery && !deepLoading && deepResults.length === 0 && (
                            <div className="flex flex-col items-center justify-center p-12 text-slate-400 opacity-60">
                                <Search className="w-10 h-10 mb-2" />
                                <p className="text-sm">No results found for "{deepQuery}"</p>
                            </div>
                        )}
                        {deepResults.map((file, idx) => {
                            const relParent = file.parent
                                ? file.parent.replace(currentDrive!.path, currentDrive!.name).replace(/\\/g, ' › ')
                                : currentDrive!.name;
                            return (
                                <div
                                    key={file.path + idx}
                                    className={`flex items-center px-4 py-3 rounded-lg group cursor-pointer transition-all border border-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/10 hover:border-indigo-100`}
                                    onClick={() => {
                                        if (file.is_dir) { navigateTo(file.path); }
                                        else {
                                            const ext = getExt(file.name);
                                            const isImage = IMAGE_EXTS.has(ext);
                                            const isVideo = ['mp4','mov','avi','mkv','webm'].includes(ext);
                                            if (isImage || isVideo) { setPreviewFile(file); }
                                            else { openItem(file.path); }
                                        }
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setSelectedItems(new Set([file.path]));
                                        setContextMenu({ x: e.clientX, y: e.clientY, item: file });
                                    }}
                                >
                                    <div className="flex-1 flex items-center gap-3 min-w-0">
                                        {file.is_dir
                                            ? <Folder className="w-5 h-5 text-yellow-500 fill-current flex-shrink-0" />
                                            : getFileIcon(file.name)}
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{getDisplayName(file.name)}</p>
                                            <p className="text-[11px] text-slate-400 truncate">{relParent}</p>
                                        </div>
                                    </div>
                                    <div className="text-xs text-slate-400 w-24 text-right flex-shrink-0">{file.is_dir ? '—' : fmtBytes(file.size)}</div>
                                    {/* Navigate-to-parent button */}
                                    {file.parent && file.parent !== currentDrive!.path && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); navigateTo(file.parent!); }}
                                            className="ml-3 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded-md transition-all text-indigo-500"
                                            title="Navigate to containing folder"
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
                                    )}
                                    {!(file.parent && file.parent !== currentDrive!.path) && (
                                        <div className="ml-3 w-8" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : loading ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--accent)' }} />
                </div>
            ) : (
                <div
                    style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', userSelect: 'none', position: 'relative', background: isDragOver ? 'var(--accent-soft)' : 'var(--surface)', border: isDragOver ? '2px dashed var(--accent)' : '1px solid transparent', transition: 'all .15s var(--ease)' }}
                    onContextMenu={(e) => e.preventDefault()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {/* Drag overlay */}
                    {isDragOver && (
                        <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                            <Plus className="w-12 h-12" style={{ color: 'var(--accent)', marginBottom: 8 }} />
                            <p style={{ color: 'var(--accent-ink)', fontWeight: 600, fontSize: 16 }}>Drop to add to drive</p>
                            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                                {currentDrive?.type === 'shortcut' ? 'Shortcuts will be created' : 'Files will be moved into drive'}
                            </p>
                        </div>
                    )}

                    {viewMode === 'list' ? (<>
                    {/* Column headers */}
                    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        <button style={{ flex: 1, textAlign: 'left', color: 'var(--faint)' }} onClick={() => toggleSort('name')}>
                            Name <SortArrow col="name" />
                        </button>
                        <button style={{ width: 128, textAlign: 'right', color: 'var(--faint)' }} onClick={() => toggleSort('modified')}>
                            Modified <SortArrow col="modified" />
                        </button>
                        <button style={{ width: 96, textAlign: 'right', color: 'var(--faint)', marginRight: 40 }} onClick={() => toggleSort('size')}>
                            Size <SortArrow col="size" />
                        </button>
                    </div>

                    <div style={{ overflowY: 'auto', flex: 1, padding: '8px' }}>
                        {sortedFiles.map((file, idx) => {
                             const isCut = clipboard.mode === 'cut' && clipboard.items.some(i => i.path === file.path);
                             const isSelected = selectedItems.has(file.path);
                             return (
                                 <div key={file.path}
                                    style={{
                                        display: 'flex', alignItems: 'center', padding: '10px 12px', borderRadius: 8,
                                        background: isSelected ? 'var(--accent-soft)' : 'transparent',
                                        border: '1px solid ' + (isSelected ? 'transparent' : 'transparent'),
                                        cursor: 'pointer', opacity: isCut ? 0.5 : 1,
                                        transition: 'background .1s',
                                    }}
                                    onClick={(e) => handleItemClick(e, file, idx)}
                                    onDoubleClick={() => {
                                        if (file.is_dir) { navigateTo(file.path); }
                                        else {
                                            const ext = getExt(file.name);
                                            if (IMAGE_EXTS.has(ext) || ['mp4','mov','avi','mkv','webm'].includes(ext)) { setPreviewFile(file); }
                                            else { openItem(file.path); }
                                        }
                                    }}
                                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedItems(new Set([file.path])); setContextMenu({ x: e.clientX, y: e.clientY, item: file }); }}
                                    onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                 >
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                                        <div style={{ width: 28, height: 28, borderRadius: 7, background: file.is_dir ? 'var(--c-ochre-bg)' : 'var(--surface-2)', color: file.is_dir ? 'var(--c-ochre)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            {file.is_dir ? <Folder className="w-4 h-4" /> : getFileIcon(file.name)}
                                        </div>
                                        <span style={{ fontSize: 13.5, fontWeight: 500, color: isSelected ? 'var(--accent-ink)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {getDisplayName(file.name)}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--muted)', width: 128, textAlign: 'right' }}>{fmtDate(file.modified)}</div>
                                    <div style={{ fontSize: 12, color: 'var(--muted)', width: 96, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{file.is_dir ? '—' : fmtBytes(file.size)}</div>
                                    <button style={{ padding: 6, color: 'var(--faint)', marginLeft: 8 }}
                                        onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY + 10, item: file }); }}>
                                        <MoreVertical className="w-3.5 h-3.5" />
                                    </button>
                                 </div>
                            );
                        })}
                        {sortedFiles.length === 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, color: 'var(--faint)' }}>
                                <Folder className="w-10 h-10" style={{ marginBottom: 8 }} />
                                <p style={{ fontSize: 13 }}>No items match</p>
                            </div>
                        )}
                    </div>
                    </>) : (
                    /* ── Grid view ── */
                    <div className="overflow-y-auto flex-1 p-4">
                        {sortedFiles.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-12 text-slate-400 opacity-60">
                                <Folder className="w-12 h-12 mb-2" />
                                <p className="text-sm">No items match</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                                {sortedFiles.map((file, idx) => {
                                    const isCut = clipboard.mode === 'cut' && clipboard.items.some(i => i.path === file.path);
                                    const isSelected = selectedItems.has(file.path);
                                    const ext = getExt(file.name);
                                    const isImage = IMAGE_EXTS.has(ext);
                                    const isVideo = ['mp4','mov','avi','mkv','webm'].includes(ext);

                                    return (
                                        <div key={file.path}
                                            className={`flex flex-col items-center p-3 rounded-xl cursor-pointer transition-all border group ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 shadow-sm' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-200 dark:hover:border-slate-700'} ${isCut ? 'opacity-50' : ''}`}
                                            onClick={(e) => handleItemClick(e, file, idx)}
                                            onDoubleClick={() => {
                                                if (file.is_dir) { navigateTo(file.path); }
                                                else if (isImage || isVideo) { setPreviewFile(file); }
                                                else { openItem(file.path); }
                                            }}
                                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedItems(new Set([file.path])); setContextMenu({ x: e.clientX, y: e.clientY, item: file }); }}
                                        >
                                            <div className="w-full aspect-[4/3] flex items-center justify-center mb-2 rounded-lg bg-slate-50 dark:bg-slate-800 group-hover:bg-slate-100 dark:group-hover:bg-slate-700 transition-colors overflow-hidden relative border border-slate-100 dark:border-slate-700">
                                                {file.is_dir ? (
                                                    <Folder className="w-16 h-16 text-yellow-500 fill-current drop-shadow-sm" />
                                                ) : isImage ? (
                                                    <img src={`${API_URL}/file?path=${encodeURIComponent(file.path)}`} alt={file.name} className="w-full h-full object-cover" loading="lazy" />
                                                ) : isVideo ? (
                                                    <>
                                                        <video src={`${API_URL}/file?path=${encodeURIComponent(file.path)}#t=1.0`} className="w-full h-full object-cover pointer-events-none" preload="metadata" />
                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/5 transition-colors">
                                                            <div className="bg-black/20 backdrop-blur-md p-2 rounded-full border border-white/20 shadow-sm">
                                                                <Video className="w-5 h-5 text-white drop-shadow-md fill-white/20" />
                                                            </div>
                                                        </div>
                                                    </>
                                                ) : (
                                                    getFileIcon(file.name, 'lg')
                                                )}
                                            </div>
                                            <p className={`text-xs text-center truncate w-full leading-tight px-1 ${isSelected ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'}`} title={getDisplayName(file.name)}>
                                                {getDisplayName(file.name)}
                                            </p>
                                            {!file.is_dir && (
                                                <p className="text-[10px] text-slate-400 mt-0.5">{fmtBytes(file.size)}</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    )}
                </div>
            )}

            {/* Context Menu */}
            {contextMenu && (
                <div
                    style={{ position: 'fixed', zIndex: 50, top: contextMenu.y, left: contextMenu.x, width: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', fontSize: 13 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{ padding: '8px 12px 6px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, color: 'var(--faint)', borderBottom: '1px solid var(--border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getDisplayName(contextMenu.item.name)}
                    </div>
                    {[
                        { label: contextMenu.item.is_dir ? 'Open' : 'Open', icon: contextMenu.item.is_dir ? Folder : ExternalLink, action: () => { contextMenu.item.is_dir ? navigateTo(contextMenu.item.path) : openItem(contextMenu.item.path); setContextMenu(null); } },
                        { label: 'Rename', icon: Edit2, action: () => { setRenamingItem(contextMenu.item); setNewName(contextMenu.item.name); setContextMenu(null); } },
                        { label: 'Copy', icon: Copy, action: () => { copySelection(); setContextMenu(null); } },
                        { label: 'Cut', icon: Scissors, action: () => { cutSelection(); setContextMenu(null); } },
                        { label: 'Move to…', icon: MoveRight, action: () => { startMoveItems(files.filter(f => selectedItems.has(f.path))); setContextMenu(null); } },
                    ].map(({ label, icon: Icon, action }) => (
                        <button key={label} onClick={action} style={{ width: '100%', textAlign: 'left', padding: '9px 14px', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 10 }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                            <Icon className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} /> {label}
                        </button>
                    ))}
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                    <button onClick={() => { deleteItem(contextMenu.item.path); setContextMenu(null); }}
                        style={{ width: '100%', textAlign: 'left', padding: '9px 14px', color: 'var(--c-clay)', display: 'flex', alignItems: 'center', gap: 10 }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-clay-bg)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                        <Trash className="w-3.5 h-3.5" /> Delete
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
            {previewFile && (
                <MediaPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
            )}
        </div>
    );
};
