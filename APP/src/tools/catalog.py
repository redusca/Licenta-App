"""
Tool catalog — UI-facing metadata for every tool available in the application.

This module is imported once on backend startup and served verbatim via
GET /api/tools/catalog.  The frontend consumes it to render the Tools page,
category grids, filter pills, and the detail view.

Structure convention
--------------------
Every tool entry mirrors the TypeScript ``ToolDefinition`` interface so the
frontend can type-check the response without any transformation.

Field descriptions are intentionally verbose because they are read by the
agent when it decides which tool to invoke and which field values to supply.
"""

from __future__ import annotations

# ── Category definitions ──────────────────────────────────────────────────

CATEGORIES: list[dict] = [
    {
        "key": "image",
        "label": "Image",
        "color": "blue",
        "icon": "Image",
        "description": "Tools that process raster and vector image files.",
    },
    {
        "key": "audio",
        "label": "Audio",
        "color": "purple",
        "icon": "Music",
        "description": "Tools that process audio recordings and music files.",
    },
    {
        "key": "video",
        "label": "Video",
        "color": "rose",
        "icon": "Video",
        "description": "Tools that manipulate or analyse video content.",
    },
    {
        "key": "documents",
        "label": "Documents & Archives",
        "color": "amber",
        "icon": "FileText",
        "description": "Tools for documents, PDFs, spreadsheets, and archives.",
    },
    {
        "key": "3d",
        "label": "3D & Modeling",
        "color": "cyan",
        "icon": "Box",
        "description": "Tools for 3D models, scenes, and CAD files.",
    },
    {
        "key": "database",
        "label": "Database",
        "color": "indigo",
        "icon": "Database",
        "description": "Tools that read, query, and transform database files.",
    },
    {
        "key": "programming",
        "label": "Programming",
        "color": "green",
        "icon": "Code",
        "description": "Tools that operate on source code and scripts.",
    },
    {
        "key": "test",
        "label": "Testing",
        "color": "emerald",
        "icon": "Zap",
        "description": "Connectivity and pipeline test utilities.",
    },
    {
        "key": "computer_tools",
        "label": "Computer Tools",
        "color": "slate",
        "icon": "HardDrive",
        "description": "System utilities, drive management, and folder operations.",
    },
]

# ── Tool catalog ──────────────────────────────────────────────────────────

TOOLS: list[dict] = [

    # ── IMAGE ─────────────────────────────────────────────────────────────

    {
        "id": "image-converter",
        "name": "Image Converter",
        "version": "1.2.0",
        "description": "Convert images between formats: JPEG, PNG, WebP, BMP, TIFF and more.",
        "longDescription": (
            "Image Converter lets you batch-convert raster image files between all common formats. "
            "It preserves EXIF metadata, supports transparency (PNG → WebP), and allows you to "
            "set quality/compression levels for lossy targets. No AI is involved — conversions "
            "are done locally using a native imaging library."
        ),
        "categories": ["image"],
        "fileExtensions": [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"],
        "usesAI": False,
        "icon": "Image",
        "accentColor": "blue",
        "author": "Core Team",
        "fields": [
            {
                "key": "inputFiles",
                "label": "Input Images",
                "type": "multifile",
                "description": "One or more image files to convert.",
                "required": True,
                "acceptedExtensions": [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"],
            },
            {
                "key": "outputFormat",
                "label": "Output Format",
                "type": "select",
                "description": "Target image format for the converted files.",
                "required": True,
                "options": ["jpeg", "png", "webp", "bmp", "tiff"],
                "default": "webp",
            },
            {
                "key": "quality",
                "label": "Quality (1-100)",
                "type": "number",
                "description": "Lossy compression quality; only applies to JPEG and WebP outputs.",
                "required": False,
                "default": 85,
            },
            {
                "key": "preserveMetadata",
                "label": "Preserve EXIF Metadata",
                "type": "boolean",
                "description": "When true, EXIF data (camera info, GPS, etc.) is copied to the output file.",
                "required": False,
                "default": True,
            },
        ],
        "usageSteps": [
            "Open the Image Converter from the Tools page and click 'Run Tool'.",
            "Click 'From Drive' to load images from a virtual drive, or 'Browse Folder' to pick any folder.",
            "Check the images you want to convert and set the target format per file (or use 'Apply to all').",
            "Adjust the quality slider for JPEG/WebP outputs.",
            "Choose an output mode: Replace originals, Copy in same folder, or save to a Virtual Drive.",
            "If using Virtual Drive mode, make sure the Output Path is set in Settings.",
            "Click Convert and review the results.",
        ],
        "tags": ["convert", "resize", "format", "batch", "jpeg", "png", "webp"],
    },

    {
        "id": "remove-background",
        "name": "Remove Background",
        "version": "1.0.0",
        "description": "Batch-remove backgrounds from images.",
        "longDescription": (
            "Remove Background lets you batch-remove backgrounds from images using rembg. "
            "It automatically detects the main subject and outputs a transparent PNG. "
            "Works entirely locally using on-device models."
        ),
        "categories": ["image"],
        "fileExtensions": [".jpg", ".jpeg", ".png", ".webp"],
        "usesAI": True,
        "icon": "ImageOff",
        "accentColor": "blue",
        "author": "Core Team",
        "fields": [
            {
                "key": "inputFiles",
                "label": "Input Images",
                "type": "multifile",
                "description": "One or more image files to process.",
                "required": True,
                "acceptedExtensions": [".jpg", ".jpeg", ".png", ".webp"],
            },
            {
                "key": "preserveMetadata",
                "label": "Preserve EXIF Metadata",
                "type": "boolean",
                "description": "When true, EXIF data (camera info, GPS, etc.) is copied to the output file.",
                "required": False,
                "default": True,
            },
        ],
        "usageSteps": [
            "Open the Remove Background tool from the Tools page and click 'Run Tool'.",
            "Select one or more input images.",
            "Choose an output mode: Replace originals, Copy in same folder, or save to a Virtual Drive.",
            "Click Remove Background and review the results.",
        ],
        "tags": ["background", "remove", "rembg", "batch", "transparent", "png"],
    },

    {
        "id": "image-to-svg",
        "name": "Image to SVG Vectorizer",
        "version": "1.0.0",
        "description": "Convert raster images to clean SVG vector files with copy-paste code output.",
        "longDescription": (
            "Image to SVG Vectorizer converts JPEG, PNG, WebP, and BMP images into scalable vector "
            "SVG files using a fast, locally-running tracing engine (vtracer). "
            "Choose between full color tracing or black-and-white binary mode. "
            "After conversion, each result shows an inline SVG preview and lets you copy the raw SVG "
            "markup to the clipboard for direct use in web pages, Figma, Illustrator, or any SVG editor. "
            "No data leaves your machine — all processing is done locally."
        ),
        "categories": ["image"],
        "fileExtensions": [".jpg", ".jpeg", ".png", ".webp", ".bmp"],
        "usesAI": False,
        "icon": "PenTool",
        "accentColor": "violet",
        "author": "Core Team",
        "fields": [
            {
                "key": "inputFiles",
                "label": "Input Images",
                "type": "multifile",
                "description": "One or more raster image files to vectorize.",
                "required": True,
                "acceptedExtensions": [".jpg", ".jpeg", ".png", ".webp", ".bmp"],
            },
            {
                "key": "colormode",
                "label": "Color Mode",
                "type": "select",
                "description": "'color' for full color SVG, 'binary' for black-and-white (faster, smaller file).",
                "required": False,
                "options": ["color", "binary"],
                "default": "color",
            },
            {
                "key": "hierarchical",
                "label": "Layering Mode",
                "type": "select",
                "description": "How color layers are stacked in the SVG. 'stacked' layers shapes on top; 'cutout' punches holes.",
                "required": False,
                "options": ["stacked", "cutout"],
                "default": "stacked",
            },
            {
                "key": "filterSpeckle",
                "label": "Speckle Filter (px)",
                "type": "number",
                "description": "Ignore noise pixels smaller than this area (in pixels). Higher = smoother result.",
                "required": False,
                "default": 4,
            },
            {
                "key": "colorPrecision",
                "label": "Color Precision (1-8)",
                "type": "number",
                "description": "Significant bits used for color quantisation. Lower reduces unique colors; higher preserves more detail.",
                "required": False,
                "default": 6,
            },
        ],
        "usageSteps": [
            "Open the Image to SVG Vectorizer from the Tools page and click 'Run Tool'.",
            "Add one or more images using Browse Files, Browse Folder, or From Virtual Drive.",
            "Choose a Color Mode: 'Color' for full-color output or 'Black & White' for outline/silhouette style.",
            "Adjust the Speckle Filter to control how much noise gets smoothed out.",
            "Select an output mode: Replace original, Copy alongside, or send to a Virtual Drive.",
            "Click Vectorize — each result shows an inline SVG preview.",
            "Use the 'Copy SVG Code' button to copy the ready-to-paste SVG markup.",
        ],
        "tags": ["svg", "vector", "vectorize", "convert", "trace", "vtracer", "batch", "scalable"],
    },

    {
        "id": "image-enhancer",
        "name": "AI Image Enhancer",
        "version": "0.9.1",
        "description": "Upscale and denoise images using an AI super-resolution model.",
        "longDescription": (
            "AI Image Enhancer uses a locally-running super-resolution neural network to upscale "
            "images up to 4× while simultaneously reducing noise and compression artefacts. "
            "It works entirely on-device — no data is sent to external servers. "
            "Supported upscale factors: 2× and 4×."
        ),
        "categories": ["image"],
        "fileExtensions": [".jpg", ".jpeg", ".png", ".webp"],
        "usesAI": True,
        "icon": "Sparkles",
        "accentColor": "blue",
        "author": "AI Labs",
        "fields": [
            {
                "key": "inputFile",
                "label": "Input Image",
                "type": "file",
                "description": "The image file to enhance.",
                "required": True,
                "acceptedExtensions": [".jpg", ".jpeg", ".png", ".webp"],
            },
            {
                "key": "scaleFactor",
                "label": "Upscale Factor",
                "type": "select",
                "description": "How many times larger the output should be compared to the input.",
                "required": True,
                "options": ["2x", "4x"],
                "default": "2x",
            },
            {
                "key": "denoise",
                "label": "Denoise",
                "type": "boolean",
                "description": "Run a denoising pass on the image before upscaling.",
                "required": False,
                "default": True,
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the AI Image Enhancer panel.",
            "Select the image you want to upscale.",
            "Choose a scale factor (2× or 4×).",
            "Optionally enable denoising.",
            "Click Enhance and wait for the model to process the image.",
            "Preview and download the enhanced result.",
        ],
        "tags": ["upscale", "super-resolution", "denoise", "AI", "enhance", "quality"],
    },

    # ── AUDIO ─────────────────────────────────────────────────────────────

    {
        "id": "audio-converter",
        "name": "Audio Converter",
        "version": "1.0.0",
        "description": "Convert audio files between formats: MP3, WAV, M4A, AAC, FLAC, OGG.",
        "longDescription": (
            "Audio Converter lets you batch-convert audio files between common formats. "
            "It supports conversion to output modes such as replacing existing files, saving identically named duplicates next to them, "
            "or exporting batch outputs into a pristine Virtual Drive sandbox. Powered natively by FFmpeg under the hood."
        ),
        "categories": ["audio"],
        "fileExtensions": [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".wma", ".mka"],
        "usesAI": False,
        "icon": "Music",
        "accentColor": "purple",
        "author": "Core Team",
        "fields": [
            {
                "key": "inputFiles",
                "label": "Input Audio",
                "type": "multifile",
                "description": "One or more audio files to convert.",
                "required": True,
                "acceptedExtensions": [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".wma", ".mka"],
            },
            {
                "key": "outputFormat",
                "label": "Output Format",
                "type": "select",
                "description": "Target audio format for the converted files.",
                "required": True,
                "options": ["mp3", "wav", "m4a", "aac", "flac", "ogg"],
                "default": "mp3",
            },
        ],
        "usageSteps": [
            "Open the Audio Converter from the Tools page and click 'Run Tool'.",
            "Click 'From Drive' to load audio from a virtual drive, or 'Browse Folder' to pick any folder.",
            "Check the audio files you want to convert and set the target format per file (or use 'Apply to all').",
            "Choose an output mode: Replace originals, Copy in same folder, or save to a Virtual Drive.",
            "If using Virtual Drive mode, make sure the Output Path is set in Settings.",
            "Click Convert and review the results.",
        ],
        "tags": ["convert", "format", "batch", "mp3", "wav", "audio"],
    },

    {
        "id": "audio-transcriber",
        "name": "Audio Transcriber",
        "version": "1.0.0",
        "description": "Transcribe speech from audio files to text using a Whisper-based model.",
        "longDescription": (
            "Audio Transcriber converts spoken audio into accurate text transcripts using a "
            "Whisper-compatible speech recognition model running on the agent container. "
            "It auto-detects language, supports diarisation (speaker labels), and can export "
            "transcripts as plain text, SRT subtitles, or JSON."
        ),
        "categories": ["audio"],
        "fileExtensions": [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"],
        "usesAI": True,
        "icon": "Mic",
        "accentColor": "purple",
        "author": "AI Labs",
        "fields": [
            {
                "key": "audioFile",
                "label": "Audio File",
                "type": "file",
                "description": "The audio file to transcribe.",
                "required": True,
                "acceptedExtensions": [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"],
            },
            {
                "key": "language",
                "label": "Language",
                "type": "select",
                "description": "Hint the model about the spoken language; use 'auto' for automatic detection.",
                "required": False,
                "options": ["auto", "en", "ro", "fr", "de", "es", "it", "pt"],
                "default": "auto",
            },
            {
                "key": "outputFormat",
                "label": "Output Format",
                "type": "select",
                "description": "Format for the exported transcript.",
                "required": False,
                "options": ["txt", "srt", "json"],
                "default": "txt",
            },
            {
                "key": "diarize",
                "label": "Speaker Diarisation",
                "type": "boolean",
                "description": "Identify and label individual speakers in the transcript.",
                "required": False,
                "default": False,
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the Audio Transcriber.",
            "Upload the audio file you want to transcribe.",
            "Select the language or leave on auto-detect.",
            "Choose the output format (TXT, SRT, or JSON).",
            "Click Transcribe and wait for the model to finish processing.",
            "Copy or download the generated transcript.",
        ],
        "tags": ["transcribe", "speech-to-text", "whisper", "AI", "subtitle", "srt"],
    },



    # ── VIDEO ─────────────────────────────────────────────────────────────

    {
        "id": "video-compressor",
        "name": "Video Compressor",
        "version": "1.3.0",
        "description": "Reduce video file size using H.264 / H.265 encoding with configurable CRF.",
        "longDescription": (
            "Video Compressor re-encodes video files using FFmpeg-backed H.264 or H.265 codec "
            "with a Constant Rate Factor (CRF) you specify. Lower CRF = higher quality, larger "
            "file. It also lets you cap the resolution and frame-rate, and strip audio tracks. "
            "All processing happens locally."
        ),
        "categories": ["video"],
        "fileExtensions": [".mp4", ".mkv", ".mov", ".avi", ".webm"],
        "usesAI": False,
        "icon": "Film",
        "accentColor": "rose",
        "author": "Core Team",
        "fields": [
            {
                "key": "inputFiles",
                "label": "Input Videos",
                "type": "multifile",
                "description": "One or more video files to compress.",
                "required": True,
                "acceptedExtensions": [".mp4", ".mkv", ".mov", ".avi", ".webm"],
            },
            {
                "key": "codec",
                "label": "Codec",
                "type": "select",
                "description": "Video codec used for re-encoding. H.265 achieves better compression at the cost of speed.",
                "required": False,
                "options": ["h264", "h265"],
                "default": "h264",
            },
            {
                "key": "crf",
                "label": "CRF (0-51)",
                "type": "number",
                "description": "Constant Rate Factor for quality. 18 is near-lossless; 28 is a good balance.",
                "required": False,
                "default": 23,
            },
            {
                "key": "maxResolution",
                "label": "Max Resolution",
                "type": "select",
                "description": "Optionally downscale the video to this resolution.",
                "required": False,
                "options": ["original", "1080p", "720p", "480p", "360p"],
                "default": "original",
            },
            {
                "key": "stripAudio",
                "label": "Strip Audio",
                "type": "boolean",
                "description": "Remove the audio track from the output file.",
                "required": False,
                "default": False,
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the Video Compressor.",
            "Upload your video file.",
            "Select a codec (H.264 for compatibility, H.265 for size).",
            "Adjust the CRF value to balance quality vs. file size.",
            "Optionally cap the resolution and click Compress.",
            "Download the compressed output file.",
        ],
        "tags": ["compress", "encode", "h264", "h265", "ffmpeg", "video", "size"],
    },

    {
        "id": "video-converter",
        "name": "Video Converter",
        "version": "1.0.0",
        "description": "Convert videos between all major formats using FFmpeg.",
        "longDescription": (
            "Video Converter lets you batch-convert video files between all common formats (MP4, AVI, MKV, MOV, WMV, FLV, WebM). "
            "It supports conversion to output modes such as overriding existing files, saving identically named duplicates next to them, "
            "or exporting batch outputs into a pristine Virtual Drive sandbox. Powered natively by FFmpeg under the hood."
        ),
        "categories": ["video"],
        "fileExtensions": [".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpeg", ".mpg"],
        "usesAI": False,
        "icon": "Video",
        "accentColor": "rose",
        "author": "Core Team",
        "fields": [
            {
                "key": "inputFiles",
                "label": "Input Videos",
                "type": "multifile",
                "description": "One or more video files to convert.",
                "required": True,
                "acceptedExtensions": [".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpeg", ".mpg"],
            },
            {
                "key": "outputFormat",
                "label": "Output Format",
                "type": "select",
                "description": "Target video format for the converted files.",
                "required": True,
                "options": ["mp4", "avi", "mkv", "mov", "wmv", "flv", "webm"],
                "default": "mp4",
            },
        ],
        "usageSteps": [
            "Open the Video Converter from the Tools page and click 'Run Tool'.",
            "Click 'From Drive' to load videos from a virtual drive, or 'Browse Folder' to pick any folder.",
            "Check the videos you want to convert and set the target format per file (or use 'Apply to all').",
            "Choose an output mode: Replace originals, Copy in same folder, or save to a Virtual Drive.",
            "If using Virtual Drive mode, make sure the Output Path is set in Settings.",
            "Click Convert and review the results.",
        ],
        "tags": ["convert", "format", "batch", "mp4", "avi", "mkv", "video"],
    },

    {
        "id": "video-summarizer",
        "name": "AI Video Summarizer",
        "version": "0.8.0",
        "description": "Generate a timestamped text summary of a video using multimodal AI.",
        "longDescription": (
            "AI Video Summarizer extracts key frames from a video, sends them along with audio "
            "transcription to a multimodal AI model, and returns a structured summary with "
            "chapter timestamps, main topics, and action items. Ideal for long meeting recordings, "
            "lectures, and tutorials."
        ),
        "categories": ["video"],
        "fileExtensions": [".mp4", ".mkv", ".mov", ".webm"],
        "usesAI": True,
        "icon": "Clapperboard",
        "accentColor": "rose",
        "author": "AI Labs",
        "fields": [
            {
                "key": "videoFile",
                "label": "Video File",
                "type": "file",
                "description": "The video to summarize.",
                "required": True,
                "acceptedExtensions": [".mp4", ".mkv", ".mov", ".webm"],
            },
            {
                "key": "detailLevel",
                "label": "Summary Detail",
                "type": "select",
                "description": "Controls how granular the generated summary is.",
                "required": False,
                "options": ["brief", "standard", "detailed"],
                "default": "standard",
            },
            {
                "key": "includeActionItems",
                "label": "Include Action Items",
                "type": "boolean",
                "description": "Extract and list action items / to-dos mentioned in the video.",
                "required": False,
                "default": True,
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the AI Video Summarizer.",
            "Upload or select a video file.",
            "Choose the summary detail level.",
            "Click Summarize and wait while the AI processes the video.",
            "Review the timestamped chapter breakdown and action items.",
            "Export the summary as Markdown or plain text.",
        ],
        "tags": ["summarize", "AI", "transcript", "chapters", "meeting", "video"],
    },

    # ── DOCUMENTS & ARCHIVES ──────────────────────────────────────────────

    {
        "id": "pdf-merger",
        "name": "PDF Toolkit",
        "version": "2.0.0",
        "description": "Merge, split, reorder PDFs and convert between PDF and Word formats.",
        "longDescription": (
            "PDF Toolkit is an all-in-one document manipulation tool. Merge multiple PDFs into "
            "a single file with drag-and-drop reordering, extract specific page ranges (split/cut), "
            "and convert between PDF and Microsoft Word (.docx) formats — all processed entirely "
            "locally using pure-Python libraries. No AI is involved."
        ),
        "categories": ["documents"],
        "fileExtensions": [".pdf", ".docx"],
        "usesAI": False,
        "icon": "FileText",
        "accentColor": "amber",
        "author": "Core Team",
        "fields": [
            {
                "key": "action",
                "label": "Action",
                "type": "select",
                "description": "The operation to perform: merge PDFs, split/extract pages, or convert formats.",
                "required": True,
                "options": ["merge", "split", "convert"],
                "default": "merge",
            },
            {
                "key": "inputFiles",
                "label": "Input Files",
                "type": "multifile",
                "description": "PDF or DOCX files to process.",
                "required": True,
                "acceptedExtensions": [".pdf", ".docx"],
            },
            {
                "key": "outputFilename",
                "label": "Output Filename",
                "type": "string",
                "description": "Base name for the merged PDF (without extension). Used in merge mode.",
                "required": False,
                "default": "merged",
            },
            {
                "key": "pageRanges",
                "label": "Page Ranges",
                "type": "string",
                "description": "Comma-separated page ranges for split mode, e.g. '1-3,5,7-9'.",
                "required": False,
                "default": "",
            },
            {
                "key": "convertTo",
                "label": "Convert To",
                "type": "select",
                "description": "Target format for conversion mode.",
                "required": False,
                "options": ["pdf", "docx"],
                "default": "docx",
            },
            {
                "key": "addBookmarks",
                "label": "Add Bookmarks",
                "type": "boolean",
                "description": "Create a bookmark for the first page of each source document (merge only).",
                "required": False,
                "default": True,
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the PDF Toolkit.",
            "Choose an action tab: Merge & Reorder, Extract Pages, or Convert Format.",
            "Add files using Browse Files or Browse Folder.",
            "For merging, drag to reorder files, then click Merge.",
            "For splitting, enter page ranges (e.g. '1-3,5') and click Extract.",
            "For conversion, select PDF→DOCX or DOCX→PDF and click Convert.",
            "Choose an output mode and review the results.",
        ],
        "tags": ["pdf", "merge", "combine", "split", "cut", "extract", "convert", "word", "docx", "reorder", "pages", "documents"],
    },

    # ── 3D & MODELING ─────────────────────────────────────────────────────

    {
        "id": "model-converter",
        "name": "3D Model Converter",
        "version": "1.0.0",
        "description": "Convert between OBJ, FBX, GLB, GLTF, STL, and PLY model formats.",
        "longDescription": (
            "3D Model Converter uses the Open Asset Import Library (Assimp) to convert 3D model "
            "files between widely-used formats. It preserves materials, UV maps, and skeletal "
            "rigs where the target format supports them. Useful for pipeline compatibility "
            "between DCC tools and game engines."
        ),
        "categories": ["3d"],
        "fileExtensions": [".obj", ".fbx", ".glb", ".gltf", ".stl", ".ply", ".dae"],
        "usesAI": False,
        "icon": "Box",
        "accentColor": "cyan",
        "author": "Core Team",
        "fields": [
            {
                "key": "inputFiles",
                "label": "3D Model Files",
                "type": "multifile",
                "description": "One or more 3D model files to convert.",
                "required": True,
                "acceptedExtensions": [".obj", ".fbx", ".glb", ".gltf", ".stl", ".ply", ".dae"],
            },
            {
                "key": "outputFormat",
                "label": "Output Format",
                "type": "select",
                "description": "Target 3D model format.",
                "required": True,
                "options": ["obj", "fbx", "glb", "gltf", "stl", "ply", "dae"],
                "default": "glb",
            },
            {
                "key": "embedTextures",
                "label": "Embed Textures",
                "type": "boolean",
                "description": "Embed texture images into the output file (GLB/GLTF only).",
                "required": False,
                "default": True,
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the 3D Model Converter.",
            "Add one or more 3D model files using Browse Files, Browse Folder, or From Virtual Drive.",
            "Choose the target format per file or use 'Apply to all' to set a global format.",
            "Choose an output mode: Replace originals, Copy in same folder, or save to a Virtual Drive.",
            "Click Convert and wait for the conversion to complete.",
            "Review the results — click 'Open' to reveal converted files.",
        ],
        "tags": ["3d", "convert", "obj", "fbx", "gltf", "glb", "stl", "ply", "dae", "trimesh"],
    },



    # ── DATABASE ──────────────────────────────────────────────────────────

    {
        "id": "sqlite-viewer",
        "name": "SQLite Viewer",
        "version": "1.5.0",
        "description": "Browse, query, and export data from SQLite database files.",
        "longDescription": (
            "SQLite Viewer opens any .sqlite / .db file and lets you explore tables, run "
            "arbitrary SQL SELECT queries, view schema (CREATE statements), and export results "
            "to CSV or JSON. All processing is local — the database file never leaves your machine."
        ),
        "categories": ["database"],
        "fileExtensions": [".sqlite", ".db", ".sqlite3"],
        "usesAI": False,
        "icon": "Database",
        "accentColor": "indigo",
        "author": "Core Team",
        "fields": [
            {
                "key": "databaseFile",
                "label": "Database File",
                "type": "file",
                "description": "The SQLite database file to open.",
                "required": True,
                "acceptedExtensions": [".sqlite", ".db", ".sqlite3"],
            },
            {
                "key": "query",
                "label": "SQL Query",
                "type": "string",
                "description": "An optional SQL SELECT statement to run on open. Leave blank to show the table list.",
                "required": False,
                "default": "",
            },
            {
                "key": "exportFormat",
                "label": "Export Format",
                "type": "select",
                "description": "Format for exporting query results.",
                "required": False,
                "options": ["csv", "json", "xlsx"],
                "default": "csv",
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the SQLite Viewer.",
            "Select a .sqlite or .db file.",
            "Browse the list of tables in the sidebar.",
            "Click a table to preview its rows, or write a custom SQL query.",
            "Export results to CSV, JSON, or XLSX.",
        ],
        "tags": ["sqlite", "database", "sql", "query", "export", "csv", "schema"],
    },



    # ── PROGRAMMING ───────────────────────────────────────────────────────



    {
        "id": "code-explainer",
        "name": "AI Code Explainer",
        "version": "1.1.0",
        "description": "Get plain-English explanations, doc comments, and refactor suggestions for code.",
        "longDescription": (
            "AI Code Explainer sends selected source code to the agent model and asks it to: "
            "(1) explain what the code does in plain English, "
            "(2) generate JSDoc / docstring comments for functions, and "
            "(3) suggest refactors/improvements. "
            "Supports all major languages. Works with the configured agent (server proxy or direct)."
        ),
        "categories": ["programming"],
        "fileExtensions": [
            ".js", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs",
            ".java", ".c", ".cpp", ".cs", ".rb", ".php", ".sh",
        ],
        "usesAI": True,
        "icon": "BrainCircuit",
        "accentColor": "green",
        "author": "AI Labs",
        "fields": [
            {
                "key": "sourceFile",
                "label": "Source File",
                "type": "file",
                "description": "The code file to explain.",
                "required": True,
                "acceptedExtensions": [
                    ".js", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs",
                    ".java", ".c", ".cpp", ".cs", ".rb", ".php", ".sh",
                ],
            },
            {
                "key": "mode",
                "label": "Explanation Mode",
                "type": "select",
                "description": "What kind of output to generate from the code.",
                "required": False,
                "options": ["explain", "document", "refactor", "all"],
                "default": "explain",
            },
            {
                "key": "detailLevel",
                "label": "Detail Level",
                "type": "select",
                "description": "How verbose the AI explanation should be.",
                "required": False,
                "options": ["brief", "standard", "detailed"],
                "default": "standard",
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the AI Code Explainer.",
            "Upload or paste a source code file.",
            "Choose the explanation mode (explain, document, refactor, or all).",
            "Click Explain and wait for the agent to respond.",
            "Read the generated explanation and copy any doc comments.",
        ],
        "tags": ["AI", "explain", "document", "refactor", "code", "comments", "LLM"],
    },

    # ── TEST ──────────────────────────────────────────────────────────────

    {
        "id": "hello-agent",
        "name": "Hello Agent",
        "version": "1.0.0",
        "description": "Sends a test prompt to the agent container and verifies the full pipeline.",
        "longDescription": (
            "Hello Agent is a connectivity test tool. It sends a fixed fun-fact prompt to the "
            "configured agent (server proxy or direct container), waits for the response, "
            "and displays all intermediate tool-call records. Use this to confirm that the "
            "API key, server URL, and agent container are correctly set up before running "
            "production tools."
        ),
        "categories": ["test"],
        "fileExtensions": [],
        "usesAI": True,
        "icon": "Zap",
        "accentColor": "emerald",
        "author": "Core Team",
        "fields": [],
        "usageSteps": [
            "Ensure the agent is configured in Settings (API key + server URL or container URL).",
            "Click \"Send to Agent\" on the Hello Agent card.",
            "Wait for the agent response to appear.",
            "Check that tool_calls are listed — this confirms the full pipeline is active.",
        ],
        "tags": ["test", "connectivity", "hello", "pipeline", "debug"],
    },

    {
        "id": "3d-visualizer",
        "name": "3D Visualizer",
        "version": "1.0.0",
        "description": "Preview 3D models (OBJ, GLTF, FBX) and apply custom textures.",
        "longDescription": (
            "3D Visualizer is a local, in-browser tool that allows you to preview 3D models "
            "with interactive camera controls (rotate, pan, zoom). You can load a 3D object "
            "file and optionally select an image texture to apply to its surface."
        ),
        "categories": ["3d"],
        "fileExtensions": [".obj", ".fbx", ".glb", ".gltf", ".stl"],
        "usesAI": False,
        "icon": "Box",
        "accentColor": "cyan",
        "author": "Core Team",
        "fields": [],
        "usageSteps": [
            "Click 'Run Tool' to open the 3D Visualizer.",
            "Select an optional texture image.",
            "Select a 3D object to load into the viewer.",
            "Use your mouse to rotate and zoom around the preview."
        ],
        "tags": ["3d", "visualize", "preview", "texture", "model"],
    },

    {
        "id": "drive-creator",
        "name": "Drive Creator",
        "version": "1.0.0",
        "description": "Group files from a selected folder by category into a Virtual Drive.",
        "longDescription": (
            "Drive Creator allows you to quickly sift through any folder and gather all files "
            "matching specific categories (like Images, Audio, Video, 3D Objects, etc.). "
            "It will then instantly create a new Virtual Drive containing shortcuts to these files, "
            "or optionally move them entirely. Built for lightning-fast scanning via MFT."
        ),
        "categories": ["computer_tools"],
        "fileExtensions": [],
        "usesAI": False,
        "icon": "FolderTree",
        "accentColor": "emerald",
        "author": "Core Team",
        "fields": [],
        "usageSteps": [
            "Open Drive Creator and click 'Run Tool'.",
            "Select the Source Folder you want to scan.",
            "Choose a file category to target (e.g., Images, Videos).",
            "Give the new Virtual Drive a name.",
            "Select whether to create shortcuts (safest) or move the original files.",
            "Click 'Create Drive'."
        ],
        "tags": ["drive", "virtual drive", "organize", "shortcut", "move", "categorize"],
    },

    {
        "id": "space-analyzer",
        "name": "Space Analyzer",
        "version": "1.0.0",
        "description": "Visualize drive space using an interactive squarified treemap.",
        "longDescription": (
            "Space Analyzer instantly scans your selected drive via the NTFS Master File Table, "
            "calculates recursive folder sizes, and displays memory usage in an interactive Treemap "
            "similar to WizTree. Find what's taking up your disk space at a glance."
        ),
        "categories": ["computer_tools"],
        "fileExtensions": [],
        "usesAI": False,
        "icon": "PieChart",
        "accentColor": "slate",
        "author": "Core Team",
        "fields": [],
        "usageSteps": [
            "Click 'Run Tool' to open Space Analyzer.",
            "Select a Drive letter (e.g. C or D).",
            "Wait a brief moment for the fast MFT scan.",
            "Explore the Treemap to see what folders use the most space.",
            "Click into blocks to drill down, or use the path bar to go back."
        ],
        "tags": ["space", "analyzer", "wiztree", "storage", "treemap", "mft", "size", "disk"],
    },
]
