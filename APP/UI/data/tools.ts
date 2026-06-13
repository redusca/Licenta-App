// ────────────────────────────────────────────────────────────────────────────
// Type definitions for the tool catalog.
//
// Data lives in the Python backend (APP/src/tools/catalog.py) and is fetched
// at runtime via GET /api/tools/catalog.  These types mirror the Python dicts
// so TypeScript can check the response shape.
// ────────────────────────────────────────────────────────────────────────────

export type CategoryKey =
    | 'image'
    | 'audio'
    | 'video'
    | 'documents'
    | '3d'
    | 'computer_tools';

export interface ToolField {
    /** Machine-readable key sent to the agent */
    key: string;
    /** Human-readable label shown in the UI */
    label: string;
    /** Data type expected by the tool */
    type: 'file' | 'string' | 'number' | 'boolean' | 'select' | 'multifile';
    /** What this field represents; used by the agent to map user intent */
    description: string;
    /** Whether the field must be provided */
    required: boolean;
    /** Allowed file extensions when type === 'file' | 'multifile' */
    acceptedExtensions?: string[];
    /** Predefined options when type === 'select' */
    options?: string[];
    /** Default value */
    default?: string | number | boolean;
}

export interface ToolDefinition {
    /** Unique slug — used in URLs and agent calls */
    id: string;
    /** Display name */
    name: string;
    /** Semver string */
    version: string;
    /** One-line summary shown on cards */
    description: string;
    /** Full description shown on the detail page */
    longDescription: string;
    /** Which category sections the tool appears in (can be multiple) */
    categories: CategoryKey[];
    /** File extensions this tool operates on */
    fileExtensions: string[];
    /** Whether this tool invokes an AI/LLM model */
    usesAI: boolean;
    /** Lucide icon name (string, resolved in components) */
    icon: string;
    /** Tailwind accent colour used for badges and icon backgrounds */
    accentColor: string;
    /** Who built/maintains the tool */
    author: string;
    /** Ordered input fields the tool expects */
    fields: ToolField[];
    /** Human-readable usage steps shown on the detail page */
    usageSteps: string[];
    /** Free-form tags for search / filtering */
    tags: string[];
}

export interface CategoryMeta {
    key: CategoryKey;
    label: string;
    /** Tailwind colour stem (e.g. "blue") */
    color: string;
    icon: string;
    description: string;
}

export interface ToolCatalog {
    tools: ToolDefinition[];
    categories: CategoryMeta[];
}

// Static fallback — shown when the backend server is unreachable.
// Tools that have dedicated runner pages will still be fully usable.
export const STATIC_CATEGORIES: CategoryMeta[] = [
    { key: 'image',          label: 'Image',                color: 'blue',   icon: 'Image',    description: 'Tools that process raster and vector image files.' },
    { key: 'audio',          label: 'Audio',                color: 'purple', icon: 'Music',    description: 'Tools that process audio recordings and music files.' },
    { key: 'video',          label: 'Video',                color: 'rose',   icon: 'Video',    description: 'Tools that manipulate or analyse video content.' },
    { key: 'documents',      label: 'Documents & Archives', color: 'amber',  icon: 'FileText', description: 'Tools for documents, PDFs, spreadsheets, and archives.' },
    { key: '3d',             label: '3D & Modeling',        color: 'cyan',   icon: 'Box',      description: 'Tools for 3D models, scenes, and CAD files.' },
    { key: 'computer_tools', label: 'Computer Tools',       color: 'slate',  icon: 'HardDrive', description: 'System utilities, drive management, and folder operations.' },
];

export const STATIC_TOOLS: ToolDefinition[] = [
    {
        id: 'image-converter', name: 'Image Converter', version: '1.2.0',
        description: 'Convert images between formats: JPEG, PNG, WebP, BMP, TIFF and more.',
        longDescription: 'Batch-convert raster image files between all common formats locally.',
        categories: ['image'], fileExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.gif'],
        usesAI: false, icon: 'Image', accentColor: 'blue', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['convert', 'resize', 'format', 'batch', 'jpeg', 'png', 'webp'],
    },
    {
        id: 'remove-background', name: 'Remove Background', version: '1.0.0',
        description: 'Batch-remove backgrounds from images.',
        longDescription: 'Remove backgrounds using rembg, running entirely locally.',
        categories: ['image'], fileExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
        usesAI: true, icon: 'ImageOff', accentColor: 'blue', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['background', 'remove', 'rembg', 'batch', 'transparent', 'png'],
    },
    {
        id: 'image-to-svg', name: 'Image to SVG Vectorizer', version: '1.0.0',
        description: 'Convert raster images to clean SVG vector files.',
        longDescription: 'Convert JPEG, PNG, WebP images to SVG using vtracer locally.',
        categories: ['image'], fileExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.bmp'],
        usesAI: false, icon: 'PenTool', accentColor: 'violet', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['svg', 'vector', 'vectorize', 'convert', 'trace'],
    },
    {
        id: 'image-enhancer', name: 'AI Image Enhancer', version: '0.9.1',
        description: 'Upscale and denoise images using an AI super-resolution model.',
        longDescription: 'Upscale images up to 4× using a locally-running neural network.',
        categories: ['image'], fileExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
        usesAI: true, icon: 'Sparkles', accentColor: 'blue', author: 'AI Labs',
        fields: [], usageSteps: [], tags: ['upscale', 'super-resolution', 'denoise', 'AI', 'enhance'],
    },
    {
        id: 'audio-converter', name: 'Audio Converter', version: '1.0.0',
        description: 'Convert audio files between formats: MP3, WAV, M4A, AAC, FLAC, OGG.',
        longDescription: 'Batch-convert audio files between common formats using FFmpeg.',
        categories: ['audio'], fileExtensions: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.mka'],
        usesAI: false, icon: 'Music', accentColor: 'purple', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['convert', 'format', 'batch', 'mp3', 'wav', 'audio'],
    },
    {
        id: 'audio-transcriber', name: 'Audio Transcriber', version: '1.0.0',
        description: 'Transcribe speech from audio files to text using a Whisper-based model.',
        longDescription: 'Converts spoken audio to text using a Whisper-compatible model.',
        categories: ['audio'], fileExtensions: ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'],
        usesAI: true, icon: 'Mic', accentColor: 'purple', author: 'AI Labs',
        fields: [], usageSteps: [], tags: ['transcribe', 'speech-to-text', 'whisper', 'AI', 'subtitle'],
    },
    {
        id: 'subtitle-generator', name: 'Subtitle Generator', version: '1.0.0',
        description: 'Generate SRT subtitle files from video using Whisper AI.',
        longDescription: 'Extracts audio, transcribes with Whisper, produces SRT subtitle files.',
        categories: ['video', 'audio'], fileExtensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'],
        usesAI: true, icon: 'Clapperboard', accentColor: 'rose', author: 'AI Labs',
        fields: [], usageSteps: [], tags: ['subtitle', 'srt', 'whisper', 'AI', 'transcribe', 'translate'],
    },
    {
        id: 'video-compressor', name: 'Video Compressor', version: '1.3.0',
        description: 'Reduce video file size using H.264 / H.265 encoding.',
        longDescription: 'Re-encodes video files using FFmpeg with configurable CRF.',
        categories: ['video'], fileExtensions: ['.mp4', '.mkv', '.mov', '.avi', '.webm'],
        usesAI: false, icon: 'Film', accentColor: 'rose', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['compress', 'encode', 'h264', 'h265', 'ffmpeg', 'video'],
    },
    {
        id: 'video-converter', name: 'Video Converter', version: '1.0.0',
        description: 'Convert videos between all major formats using FFmpeg.',
        longDescription: 'Batch-convert video files between MP4, AVI, MKV, MOV, WMV, FLV, WebM.',
        categories: ['video'], fileExtensions: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'],
        usesAI: false, icon: 'Video', accentColor: 'rose', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['convert', 'format', 'batch', 'mp4', 'avi', 'mkv', 'video'],
    },
    {
        id: 'pdf-merger', name: 'PDF Toolkit', version: '2.0.0',
        description: 'Merge, split, reorder PDFs and convert between PDF and Word formats.',
        longDescription: 'All-in-one PDF manipulation: merge, split, convert — all locally.',
        categories: ['documents'], fileExtensions: ['.pdf', '.docx'],
        usesAI: false, icon: 'FileText', accentColor: 'amber', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['pdf', 'merge', 'split', 'convert', 'word', 'docx'],
    },
    {
        id: 'document-analytics', name: 'Document Analytics', version: '1.0.0',
        description: 'Analyze any document for word count, readability, keywords, and AI-powered insights.',
        longDescription: 'Computes stats and optional LLM insights for PDF, DOCX, TXT, MD, HTML.',
        categories: ['documents'], fileExtensions: ['.pdf', '.docx', '.txt', '.md', '.html', '.htm'],
        usesAI: true, icon: 'BarChart2', accentColor: 'amber', author: 'AI Labs',
        fields: [], usageSteps: [], tags: ['analytics', 'document', 'readability', 'word count', 'keywords', 'summary'],
    },
    {
        id: 'document-converter', name: 'Document Converter', version: '1.0.0',
        description: 'Convert between PDF, Word, TXT, HTML, Markdown, and image formats.',
        longDescription: 'Versatile all-local document format conversion with batch support.',
        categories: ['documents'], fileExtensions: ['.pdf', '.docx', '.doc', '.txt', '.html', '.htm', '.md'],
        usesAI: false, icon: 'FileText', accentColor: 'amber', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['convert', 'pdf', 'docx', 'word', 'txt', 'html', 'markdown'],
    },
    {
        id: 'model-converter', name: '3D Model Converter', version: '1.0.0',
        description: 'Convert between OBJ, FBX, GLB, GLTF, STL, and PLY model formats.',
        longDescription: 'Uses Assimp to convert 3D model files between widely-used formats.',
        categories: ['3d'], fileExtensions: ['.obj', '.fbx', '.glb', '.gltf', '.stl', '.ply', '.dae'],
        usesAI: false, icon: 'Box', accentColor: 'cyan', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['3d', 'convert', 'obj', 'fbx', 'gltf', 'glb', 'stl'],
    },
    {
        id: '3d-visualizer', name: '3D Visualizer', version: '1.0.0',
        description: 'Preview 3D models (OBJ, GLTF, FBX) and apply custom textures.',
        longDescription: 'In-browser 3D model viewer with interactive camera controls.',
        categories: ['3d'], fileExtensions: ['.obj', '.fbx', '.glb', '.gltf', '.stl'],
        usesAI: false, icon: 'Box', accentColor: 'cyan', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['3d', 'visualize', 'preview', 'texture', 'model'],
    },
    {
        id: 'drive-creator', name: 'Drive Creator', version: '1.0.0',
        description: 'Group files from a selected folder by category into a Virtual Drive.',
        longDescription: 'Scans folders via MFT and creates virtual drives with categorized files.',
        categories: ['computer_tools'], fileExtensions: [],
        usesAI: false, icon: 'FolderTree', accentColor: 'emerald', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['drive', 'virtual drive', 'organize', 'shortcut', 'move'],
    },
    {
        id: 'space-analyzer', name: 'Space Analyzer', version: '1.0.0',
        description: 'Visualize drive space using an interactive squarified treemap.',
        longDescription: 'Fast MFT-based disk usage scan with interactive treemap visualization.',
        categories: ['computer_tools'], fileExtensions: [],
        usesAI: false, icon: 'PieChart', accentColor: 'slate', author: 'Core Team',
        fields: [], usageSteps: [], tags: ['space', 'analyzer', 'storage', 'treemap', 'mft', 'disk'],
    },
];

export const STATIC_CATALOG: ToolCatalog = {
    tools: STATIC_TOOLS,
    categories: STATIC_CATEGORIES,
};
