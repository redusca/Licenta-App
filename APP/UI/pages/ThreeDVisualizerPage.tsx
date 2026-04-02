import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Box, ChevronRight, Image as ImageIcon, FileBox, AlertCircle, Loader2, X, HardDrive, FolderOpen, File as FileIcon } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Html } from '@react-three/drei';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { DrivePickerModal } from '../components/DrivePickerModal';

const FLASK_BASE = 'http://127.0.0.1:5000';
const MODEL_EXTS = ['obj', 'gltf', 'glb', 'fbx', 'stl', 'blend'];
const TEXTURE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tga', 'tiff'];

function fileUrl(path: string) {
    return `${FLASK_BASE}/api/drive/file?path=${encodeURIComponent(path)}`;
}

function getExt(name: string) {
    return name.split('.').pop()?.toLowerCase() || '';
}

// ── Types ────────────────────────────────────────────────────────

interface FolderFile {
    name: string;
    path: string;
    size: number;
    is_dir: boolean;
}

// ── Texture loading via fetch → blob URL → THREE.TextureLoader ──

async function loadTextureFromPath(filePath: string): Promise<THREE.Texture> {
    const url = fileUrl(filePath);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${filePath}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    return new Promise<THREE.Texture>((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous');
        loader.load(
            blobUrl,
            (tex) => {
                tex.flipY = true;
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.generateMipmaps = true;
                tex.needsUpdate = true;
                resolve(tex);
            },
            undefined,
            (err) => {
                URL.revokeObjectURL(blobUrl);
                reject(err);
            }
        );
    });
}

function classifyTexture(name: string): string {
    const n = name.toLowerCase();
    // Strip extension for cleaner matching
    const base = n.replace(/\.[^.]+$/, '');
    if (/(?:norm|nrm|_n$|_n_)/.test(base))                                    return 'normal';
    if (/(?:rough|_r$|_r_)/.test(base))                                        return 'roughness';
    if (/(?:metal|_m$|_m_)/.test(base))                                        return 'metalness';
    if (/(?:emit|glow|emiss)/.test(base))                                      return 'emissive';
    if (/(?:_ao|ambient|occlusion)/.test(base))                                return 'ao';
    if (/(?:disp|height|bump)/.test(base))                                     return 'displacement';
    if (/(?:opacity|alpha|transp)/.test(base))                                 return 'alpha';
    // Anything with diffuse/albedo/base/color/col/diff explicitly
    if (/(?:diff|albedo|base.?col|_col|_color|_d$|_d_)/.test(base))            return 'diffuse';
    // Default: treat as diffuse (most textures without a label are the color map)
    return 'diffuse';
}

// ── Ensure meshes have UV coordinates ──
function ensureUVs(obj: THREE.Object3D) {
    obj.traverse((child: any) => {
        if (!child.isMesh) return;
        const geom = child.geometry as THREE.BufferGeometry;
        if (geom && !geom.attributes.uv) {
            // Generate simple box-projected UVs so textures can map
            const pos = geom.attributes.position;
            if (pos) {
                const uvs = new Float32Array(pos.count * 2);
                const normal = geom.attributes.normal;
                for (let i = 0; i < pos.count; i++) {
                    const x = pos.getX(i);
                    const y = pos.getY(i);
                    const z = pos.getZ(i);
                    if (normal) {
                        const nx = Math.abs(normal.getX(i));
                        const ny = Math.abs(normal.getY(i));
                        const nz = Math.abs(normal.getZ(i));
                        if (nx >= ny && nx >= nz) {
                            uvs[i * 2] = z;
                            uvs[i * 2 + 1] = y;
                        } else if (ny >= nx && ny >= nz) {
                            uvs[i * 2] = x;
                            uvs[i * 2 + 1] = z;
                        } else {
                            uvs[i * 2] = x;
                            uvs[i * 2 + 1] = y;
                        }
                    } else {
                        uvs[i * 2] = x;
                        uvs[i * 2 + 1] = y;
                    }
                }
                geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            }
        }
        // Also ensure uv2 for AO maps
        if (geom && geom.attributes.uv && !geom.attributes.uv2) {
            geom.setAttribute('uv2', geom.attributes.uv);
        }
    });
}

// ── 3D Model Component ──────────────────────────────────────────

function Model({
    modelPath,
    folderPath,
    folderFiles,
}: {
    modelPath: string;
    folderPath: string;
    folderFiles: FolderFile[];
}) {
    const [object, setObject] = useState<THREE.Object3D | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState('Loading model…');
    // Bump to force React Three Fiber to re-render the primitive
    const [, setVersion] = useState(0);

    useEffect(() => {
        if (!modelPath || !folderPath) return;

        let cancelled = false;

        setObject(null);
        setError(null);
        setStatus('Loading model…');

        const ext = getExt(modelPath);
        // Manager that resolves relative texture refs through our file API
        const loadingManager = new THREE.LoadingManager();
        loadingManager.setURLModifier((url: string) => {
            // If it's already a valid API file URL (with path= query), keep it
            if (url.includes('/api/drive/file?path=')) return url;
            // If it's a blob URL, keep it
            if (url.startsWith('blob:')) return url;
            // If it's a data URL, keep it
            if (url.startsWith('data:')) return url;
            // Extract just the filename from the URL or path
            let filename = url;
            try {
                const parsed = new URL(url);
                filename = parsed.pathname.split('/').pop() || url;
            } catch {
                filename = url.split(/[\\/]/).pop() || url;
            }
            // Decode in case it was URL-encoded
            filename = decodeURIComponent(filename);
            // Find this file in our folder listing (case-insensitive)
            const match = folderFiles.find(f => f.name.toLowerCase() === filename.toLowerCase());
            if (match) return fileUrl(match.path);
            // Fallback: try to construct the URL directly
            return `${FLASK_BASE}/api/drive/file?path=${encodeURIComponent(folderPath + '\\' + filename)}`;
        });

        // ── normalise: scale + center + ensure UVs ──
        const normalise = (obj: THREE.Object3D) => {
            // Ensure all meshes have UVs for texture mapping
            ensureUVs(obj);

            obj.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(obj);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0 && maxDim !== Infinity) obj.scale.setScalar(4 / maxDim);
            obj.updateMatrixWorld(true);

            const box2 = new THREE.Box3().setFromObject(obj);
            const c = box2.getCenter(new THREE.Vector3());
            const s2 = box2.getSize(new THREE.Vector3());
            obj.position.x -= c.x;
            obj.position.y -= (c.y - s2.y / 2);
            obj.position.z -= c.z;

            obj.traverse((child: any) => {
                if (child.isMesh && child.material) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((m: any) => { m.side = THREE.DoubleSide; });
                }
            });
        };

        // ── applyTextures: fetch-based, fully async ──
        const applyTextures = async (obj: THREE.Object3D) => {
            const texFiles = folderFiles.filter(f => !f.is_dir && TEXTURE_EXTS.includes(getExt(f.name)));
            if (texFiles.length === 0) { setStatus(''); return; }

            setStatus(`Loading ${texFiles.length} texture(s)…`);

            const texMap: Record<string, THREE.Texture> = {};
            const texSizes: Record<string, number> = {};

            // Load all textures in parallel via fetch (no <img> cross-origin issues)
            const results = await Promise.allSettled(
                texFiles.map(async (tf) => {
                    const tex = await loadTextureFromPath(tf.path);
                    const slot = classifyTexture(tf.name);
                    return { tex, slot, name: tf.name, size: tf.size };
                })
            );

            if (cancelled) return;

            for (const r of results) {
                if (r.status === 'fulfilled') {
                    const { tex, slot, size } = r.value;
                    // For the diffuse slot, prefer the LARGEST file (the main color map
                    // is almost always the biggest texture; avoids e.g. 'black.png' winning)
                    if (!texMap[slot]) {
                        texMap[slot] = tex;
                        texSizes[slot] = size;
                    } else if (slot === 'diffuse' && size > (texSizes[slot] || 0)) {
                        texMap[slot] = tex;
                        texSizes[slot] = size;
                    }
                } else {
                    console.warn('Texture load failed:', r.reason);
                }
            }

            if (Object.keys(texMap).length === 0) {
                setStatus('');
                return;
            }

            // Apply to every mesh: create a fresh MeshStandardMaterial
            obj.traverse((child: any) => {
                if (!child.isMesh) return;

                // CRITICAL: Use white base color when diffuse texture is present.
                // Old material color can be very dark and multiplies with the texture.
                const hasDiffuse = !!texMap['diffuse'];
                const newMat = new THREE.MeshStandardMaterial({
                    side: THREE.DoubleSide,
                    color: hasDiffuse ? new THREE.Color(0xffffff) : new THREE.Color(0xcccccc),
                    roughness: texMap['roughness'] ? 1.0 : 0.7,
                    metalness: texMap['metalness'] ? 1.0 : 0.0,
                });

                if (texMap['diffuse']) {
                    texMap['diffuse'].colorSpace = THREE.SRGBColorSpace;
                    newMat.map = texMap['diffuse'];
                }
                if (texMap['normal'])    newMat.normalMap = texMap['normal'];
                if (texMap['roughness']) newMat.roughnessMap = texMap['roughness'];
                if (texMap['metalness']) newMat.metalnessMap = texMap['metalness'];
                if (texMap['emissive']) {
                    newMat.emissiveMap = texMap['emissive'];
                    newMat.emissive = new THREE.Color(1, 1, 1);
                }
                if (texMap['ao'])        newMat.aoMap = texMap['ao'];
                if (texMap['displacement']) {
                    newMat.displacementMap = texMap['displacement'];
                    newMat.displacementScale = 0.1;
                }
                if (texMap['alpha']) {
                    newMat.alphaMap = texMap['alpha'];
                    newMat.transparent = true;
                }

                newMat.needsUpdate = true;
                child.material = newMat;
            });

            // Bump version to force R3F re-render
            if (!cancelled) {
                setVersion(v => v + 1);
                setStatus('');
            }
        };

        // ── Load model, then apply textures ──
        const loadAndApply = (obj: THREE.Object3D) => {
            if (cancelled) return;
            normalise(obj);
            setObject(obj);
            applyTextures(obj);
        };

        if (ext === 'obj') {
            const mtlFile = folderFiles.find(f => getExt(f.name) === 'mtl');

            if (mtlFile) {
                setStatus('Loading materials…');
                const mtlLoader = new MTLLoader(loadingManager);
                mtlLoader.setCrossOrigin('anonymous');

                mtlLoader.load(fileUrl(mtlFile.path), (materials) => {
                    if (cancelled) return;
                    materials.preload();
                    setStatus('Loading model…');
                    const objLoader = new OBJLoader(loadingManager);
                    objLoader.setMaterials(materials);
                    objLoader.load(fileUrl(modelPath), (obj) => loadAndApply(obj),
                        undefined, (err: any) => { if (!cancelled) setError(`OBJ load failed: ${err.message || 'Unknown'}`); });
                }, undefined, () => {
                    // MTL failed — load without
                    const objLoader = new OBJLoader(loadingManager);
                    objLoader.load(fileUrl(modelPath), (obj) => loadAndApply(obj),
                        undefined, (err: any) => { if (!cancelled) setError(`OBJ load failed: ${err.message || 'Unknown'}`); });
                });
            } else {
                const objLoader = new OBJLoader(loadingManager);
                objLoader.load(fileUrl(modelPath), (obj) => loadAndApply(obj),
                    undefined, (err: any) => { if (!cancelled) setError(`OBJ load failed: ${err.message || 'Unknown'}`); });
            }
        } else if (ext === 'gltf' || ext === 'glb') {
            const gltfLoader = new GLTFLoader(loadingManager);
            gltfLoader.load(fileUrl(modelPath), (gltf) => {
                if (cancelled) return;
                const scene = gltf.scene || gltf.scenes[0];
                normalise(scene);
                setObject(scene);
                setStatus('');
            }, undefined, (err: any) => { if (!cancelled) setError(`GLTF load failed: ${err.message || 'Unknown'}`); });
        } else if (ext === 'fbx') {
            const fbxLoader = new FBXLoader(loadingManager);
            fbxLoader.setCrossOrigin('anonymous');
            fbxLoader.load(fileUrl(modelPath), (obj) => {
                if (cancelled) return;
                normalise(obj);
                setObject(obj);

                // Check if FBX textures actually loaded with valid image data
                let workingTexCount = 0;
                obj.traverse((child: any) => {
                    if (!child.isMesh) return;
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((m: any) => {
                        if (m?.map) {
                            // A texture is "working" if the image loaded
                            const img = m.map.image;
                            if (img && (img.width > 0 || img instanceof ImageBitmap)) {
                                workingTexCount++;
                            }
                        }
                    });
                });

                // Only apply folder textures if FBX's own textures didn't load
                if (workingTexCount === 0) {
                    applyTextures(obj);
                } else {
                    setStatus('');
                }
            }, undefined, (err: any) => { if (!cancelled) setError(`FBX load failed: ${err.message || 'Unknown'}`); });
        } else if (ext === 'stl') {
            const stlLoader = new STLLoader();
            stlLoader.load(fileUrl(modelPath), (geometry) => {
                if (cancelled) return;
                const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
                const mesh = new THREE.Mesh(geometry, mat);
                const wrapper = new THREE.Object3D();
                wrapper.add(mesh);
                loadAndApply(wrapper);
            }, undefined, (err: any) => { if (!cancelled) setError(`STL load failed: ${err.message || 'Unknown'}`); });
        } else if (ext === 'blend') {
            // .blend files need backend conversion to GLB first
            setStatus('Converting .blend to GLB…');
            fetch(`${FLASK_BASE}/api/tools/blend-to-glb`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: modelPath }),
            })
                .then(r => r.json())
                .then(data => {
                    if (cancelled) return;
                    if (data.error) {
                        setError(data.error);
                        return;
                    }
                    const glbPath = data.glbPath;
                    setStatus('Loading converted model…');
                    const gltfLoader = new GLTFLoader(loadingManager);
                    gltfLoader.load(fileUrl(glbPath), (gltf) => {
                        if (cancelled) return;
                        const scene = gltf.scene || gltf.scenes[0];
                        loadAndApply(scene);
                    }, undefined, (err: any) => { if (!cancelled) setError(`GLB load failed: ${err.message || 'Unknown'}`); });
                })
                .catch(err => { if (!cancelled) setError(`Blend conversion failed: ${err.message}`); });
        } else {
            setError(`Unsupported format: .${ext}`);
        }

        return () => { cancelled = true; };
    }, [modelPath, folderPath, JSON.stringify(folderFiles.map(f => f.path))]);

    if (error) {
        return (
            <Html center>
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm whitespace-nowrap shadow-lg">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            </Html>
        );
    }

    if (!object && !error) {
        return (
            <Html center>
                <div className="flex flex-col items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-2xl shadow-2xl">
                    <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mb-3" />
                    <p className="text-sm font-medium text-slate-200">{status || 'Loading…'}</p>
                </div>
            </Html>
        );
    }

    return object ? <primitive object={object} /> : null;
}

// ── Page Component ────────────────────────────────────────────

export const ThreeDVisualizerPage: React.FC = () => {
    const navigate = useNavigate();

    const [folderPath, setFolderPath] = useState<string | null>(null);
    const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
    const [modelPath, setModelPath] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [isDriveOpen, setIsDriveOpen] = useState(false);

    // Derived lists
    const modelFiles = useMemo(() => folderFiles.filter(f => !f.is_dir && MODEL_EXTS.includes(getExt(f.name))), [folderFiles]);
    const textureFiles = useMemo(() => folderFiles.filter(f => !f.is_dir && TEXTURE_EXTS.includes(getExt(f.name))), [folderFiles]);
    const mtlFiles = useMemo(() => folderFiles.filter(f => !f.is_dir && getExt(f.name) === 'mtl'), [folderFiles]);

    // Load folder contents from API
    const loadFolder = async (path: string) => {
        setLoading(true);
        setModelPath(null);
        setFolderFiles([]);
        setFolderPath(path);
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list-recursive?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            const files = (data.files || []) as FolderFile[];
            setFolderFiles(files);

            // Auto-select the first model file found
            const firstModel = files.find(f => !f.is_dir && MODEL_EXTS.includes(getExt(f.name)));
            if (firstModel) setModelPath(firstModel.path);
        } catch (e) {
            console.error('Failed to load folder', e);
        } finally {
            setLoading(false);
        }
    };

    const selectFolder = async () => {
        const path = await (window as any).electronAPI?.selectDirectory?.();
        if (path) loadFolder(path);
    };

    const selectSingleModel = async () => {
        const paths = await (window as any).electronAPI?.selectFiles?.({
            filters: [{ name: '3D Models', extensions: MODEL_EXTS }],
        });
        if (paths && paths.length > 0) {
            const filePath = paths[0];
            // Use parent folder as the folder path
            const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
            const parent = lastSlash !== -1 ? filePath.substring(0, lastSlash) : filePath;
            setModelPath(filePath);
            setFolderPath(parent);
            // Load folder contents for texture auto-detection
            try {
                const res = await fetch(`${FLASK_BASE}/api/drive/list-recursive?path=${encodeURIComponent(parent)}`);
                const data = await res.json();
                setFolderFiles((data.files || []) as FolderFile[]);
            } catch (e) {
                setFolderFiles([]);
            }
        }
    };

    const clearAll = () => {
        setFolderPath(null);
        setFolderFiles([]);
        setModelPath(null);
    };

    const modelUrl = useMemo(() => modelPath ? fileUrl(modelPath) : null, [modelPath]);

    return (
        <div className="space-y-6 max-w-6xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-sm text-slate-500 shrink-0">
                <Link to="/tools" className="hover:text-slate-300 transition-colors">Tools</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools?category=3d" className="hover:text-slate-300 transition-colors">3D & Modeling</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools/3d-visualizer" className="hover:text-slate-300 transition-colors">3D Visualizer</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">Run</span>
            </nav>

            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                        <Box className="w-6 h-6 text-cyan-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">3D Visualizer</h1>
                        <p className="text-sm text-slate-500">Preview 3D objects with textures and materials</p>
                    </div>
                </div>
                <button type="button" onClick={() => navigate('/tools/3d-visualizer')}
                    className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Info
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
                {/* ── Left Sidebar ── */}
                <div className="lg:col-span-1 space-y-4 overflow-y-auto pr-1">

                    {/* Folder / Model Picker */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-semibold text-slate-300">Source</p>
                            {folderPath && (
                                <button type="button" onClick={clearAll} className="p-1 hover:text-red-400 transition-colors" title="Clear">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        {folderPath ? (
                            <div className="space-y-3">
                                {/* Folder info */}
                                <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg">
                                    <FolderOpen className="w-5 h-5 text-amber-400 shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium truncate">{folderPath.split(/[\\/]/).pop()}</p>
                                        <p className="text-xs text-slate-500 truncate">{folderPath}</p>
                                    </div>
                                </div>

                                {/* Model selector (if multiple models in folder) */}
                                {modelFiles.length > 1 && (
                                    <div>
                                        <p className="text-xs font-medium text-slate-400 mb-1.5">Model File</p>
                                        <select
                                            value={modelPath || ''}
                                            onChange={e => setModelPath(e.target.value)}
                                            className="w-full text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                                        >
                                            {modelFiles.map(f => (
                                                <option key={f.path} value={f.path}>{f.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                {modelFiles.length === 1 && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
                                        <FileBox className="w-4 h-4 text-cyan-400 shrink-0" />
                                        <p className="text-xs font-medium text-cyan-300 truncate">{modelFiles[0].name}</p>
                                    </div>
                                )}
                                {modelFiles.length === 0 && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-red-500/5 border border-red-500/20 rounded-lg">
                                        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                                        <p className="text-xs text-red-400">No 3D model found in this folder</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {loading ? (
                                    <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span className="text-sm">Scanning folder…</span>
                                    </div>
                                ) : (
                                    <>
                                        <button type="button" onClick={selectFolder}
                                            className="w-full py-4 border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors bg-slate-800/30 hover:bg-cyan-500/5">
                                            <FolderOpen className="w-6 h-6" />
                                            <span className="text-sm font-medium">Select Model Folder</span>
                                            <span className="text-xs text-slate-500">Model + textures auto-detected</span>
                                        </button>
                                        <div className="flex items-center gap-2 my-1">
                                            <div className="flex-1 border-t border-slate-800" />
                                            <span className="text-xs text-slate-600 uppercase">or</span>
                                            <div className="flex-1 border-t border-slate-800" />
                                        </div>
                                        <button type="button" onClick={selectSingleModel}
                                            className="w-full py-3 border border-slate-700 hover:border-cyan-500 rounded-xl flex items-center justify-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors hover:bg-cyan-500/5">
                                            <FileIcon className="w-4 h-4" />
                                            <span className="text-sm font-medium">Select Model File</span>
                                        </button>
                                        <button type="button" onClick={() => setIsDriveOpen(true)}
                                            className="w-full py-3 border border-slate-700 hover:border-cyan-500 rounded-xl flex items-center justify-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors hover:bg-cyan-500/5">
                                            <HardDrive className="w-4 h-4" />
                                            <span className="text-sm font-medium">Browse My Drive</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Auto-detected Assets Summary */}
                    {folderPath && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Detected Assets</p>
                            <div className="space-y-2">
                                {/* MTL files */}
                                {mtlFiles.length > 0 && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-green-500/5 border border-green-500/20 rounded-lg">
                                        <FileBox className="w-4 h-4 text-green-400 shrink-0" />
                                        <span className="text-xs text-green-300">
                                            {mtlFiles.length} material file{mtlFiles.length > 1 ? 's' : ''} (.mtl)
                                        </span>
                                    </div>
                                )}

                                {/* Texture files */}
                                {textureFiles.length > 0 ? (
                                    <div>
                                        <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/5 border border-blue-500/20 rounded-lg mb-2">
                                            <ImageIcon className="w-4 h-4 text-blue-400 shrink-0" />
                                            <span className="text-xs text-blue-300">
                                                {textureFiles.length} texture{textureFiles.length > 1 ? 's' : ''} found
                                            </span>
                                        </div>
                                        <div className="space-y-1 max-h-40 overflow-y-auto">
                                            {textureFiles.map((tf, i) => {
                                                const n = tf.name.toLowerCase();
                                                let badge = 'Diffuse';
                                                let badgeColor = 'text-blue-400';
                                                if (n.includes('norm'))                                { badge = 'Normal'; badgeColor = 'text-purple-400'; }
                                                else if (n.includes('rough'))                          { badge = 'Rough'; badgeColor = 'text-amber-400'; }
                                                else if (n.includes('metal'))                          { badge = 'Metal'; badgeColor = 'text-slate-300'; }
                                                else if (n.includes('ao') || n.includes('ambient'))    { badge = 'AO'; badgeColor = 'text-emerald-400'; }
                                                else if (n.includes('emit') || n.includes('glow'))     { badge = 'Emit'; badgeColor = 'text-orange-400'; }
                                                return (
                                                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs">
                                                        <span className="truncate flex-1 text-slate-400" title={tf.name}>{tf.name}</span>
                                                        <span className={`${badgeColor} text-[10px] font-semibold uppercase shrink-0`}>{badge}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-500 px-2">No texture files detected</p>
                                )}
                            </div>
                            <p className="text-xs text-slate-500 mt-3 leading-snug">
                                Textures are auto-mapped by filename: <code className="text-slate-400">norm</code>, <code className="text-slate-400">rough</code>, <code className="text-slate-400">metal</code>, <code className="text-slate-400">ao</code>, <code className="text-slate-400">emit</code> → PBR slots. Others → diffuse.
                            </p>
                        </div>
                    )}
                </div>

                {/* ── Right Canvas (Viewer) ── */}
                <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl shadow-inner relative overflow-hidden flex items-center justify-center">
                    {!modelUrl ? (
                        <div className="flex flex-col items-center text-slate-500 gap-3">
                            <Box className="w-12 h-12 opacity-20" />
                            <p className="text-sm">Select a folder or model file to begin.</p>
                        </div>
                    ) : (
                        <Canvas shadows gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }} camera={{ position: [0, 2, 8], fov: 45 }}>
                            <ambientLight intensity={0.6} />
                            <directionalLight position={[10, 10, 5]} intensity={1.5} castShadow shadow-bias={-0.0001} />
                            <directionalLight position={[-10, 5, -5]} intensity={0.5} />
                            <Environment preset="city" />
                            <Suspense fallback={null}>
                                <Model
                                    modelPath={modelPath!}
                                    folderPath={folderPath!}
                                    folderFiles={folderFiles}
                                />
                                <ContactShadows position={[0, 0, 0]} opacity={0.4} scale={10} blur={2} />
                                <OrbitControls makeDefault autoRotate autoRotateSpeed={1} target={[0, 2, 0]} />
                            </Suspense>
                        </Canvas>
                    )}
                </div>
            </div>

            {/* Drive Picker — navigates folders, selects a model file */}
            <DrivePickerModal
                isOpen={isDriveOpen}
                onClose={() => setIsDriveOpen(false)}
                onSelect={(path) => {
                    // If user selected a model file, load its parent folder
                    const ext = getExt(path);
                    if (MODEL_EXTS.includes(ext)) {
                        const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
                        const parent = lastSlash !== -1 ? path.substring(0, lastSlash) : path;
                        setModelPath(path);
                        setFolderPath(parent);
                        fetch(`${FLASK_BASE}/api/drive/list-recursive?path=${encodeURIComponent(parent)}`)
                            .then(r => r.json())
                            .then(data => setFolderFiles((data.files || []) as FolderFile[]))
                            .catch(() => setFolderFiles([]));
                    }
                }}
                filters={MODEL_EXTS}
                title="Select 3D Model from Drives"
            />
        </div>
    );
};
