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

    {
        "id": "audio-normalizer",
        "name": "Audio Normalizer",
        "version": "1.1.0",
        "description": "Normalize audio loudness to a target LUFS level without AI processing.",
        "longDescription": (
            "Audio Normalizer analyses the integrated loudness of an audio file and applies "
            "dynamic range compression and gain adjustment to hit a target EBU R128 / LUFS value. "
            "Useful for evening out volume differences between podcast episodes, music tracks, "
            "or video narration. Processing is fully local — no AI required."
        ),
        "categories": ["audio"],
        "fileExtensions": [".mp3", ".wav", ".ogg", ".flac", ".aac"],
        "usesAI": False,
        "icon": "AudioWaveform",
        "accentColor": "purple",
        "author": "Core Team",
        "fields": [
            {
                "key": "audioFile",
                "label": "Audio File",
                "type": "file",
                "description": "The audio file to normalize.",
                "required": True,
                "acceptedExtensions": [".mp3", ".wav", ".ogg", ".flac", ".aac"],
            },
            {
                "key": "targetLufs",
                "label": "Target Loudness (LUFS)",
                "type": "number",
                "description": "Integrated loudness target in LUFS. -14 is standard for streaming; -23 for broadcast.",
                "required": False,
                "default": -14,
            },
            {
                "key": "outputFormat",
                "label": "Output Format",
                "type": "select",
                "description": "Container format for the normalized audio.",
                "required": False,
                "options": ["mp3", "wav", "ogg", "flac"],
                "default": "mp3",
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the Audio Normalizer.",
            "Upload your audio file.",
            "Set the target LUFS level (-14 for streaming, -23 for broadcast).",
            "Choose an output format.",
            "Click Normalize and download the result.",
        ],
        "tags": ["normalize", "loudness", "LUFS", "EBU R128", "audio", "volume"],
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
                "key": "videoFile",
                "label": "Video File",
                "type": "file",
                "description": "The video file to compress.",
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
        "name": "PDF Merger",
        "version": "2.0.0",
        "description": "Combine multiple PDF files into a single document and reorder pages.",
        "longDescription": (
            "PDF Merger lets you drag-and-drop multiple PDF files, reorder them (or individual pages), "
            "and merge them into a single output PDF. It also supports adding blank pages, "
            "rotating pages, and setting document metadata. No AI is involved — all operations "
            "are done locally using a pure-Python PDF library."
        ),
        "categories": ["documents"],
        "fileExtensions": [".pdf"],
        "usesAI": False,
        "icon": "FileText",
        "accentColor": "amber",
        "author": "Core Team",
        "fields": [
            {
                "key": "inputFiles",
                "label": "PDF Files",
                "type": "multifile",
                "description": "Two or more PDF files to merge. Order determines the page sequence.",
                "required": True,
                "acceptedExtensions": [".pdf"],
            },
            {
                "key": "outputFilename",
                "label": "Output Filename",
                "type": "string",
                "description": "Name for the merged PDF file (without extension).",
                "required": False,
                "default": "merged",
            },
            {
                "key": "addBookmarks",
                "label": "Add Bookmarks",
                "type": "boolean",
                "description": "Create a bookmark for the first page of each source document.",
                "required": False,
                "default": True,
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the PDF Merger.",
            "Add two or more PDF files using the file picker.",
            "Drag to reorder files if needed.",
            "Optionally enable bookmarks, then click Merge.",
            "Download the resulting merged PDF.",
        ],
        "tags": ["pdf", "merge", "combine", "pages", "documents", "reorder"],
    },

    {
        "id": "archive-extractor",
        "name": "Archive Extractor",
        "version": "1.4.0",
        "description": "Extract ZIP, TAR, RAR, 7z and other archive formats in one click.",
        "longDescription": (
            "Archive Extractor decompresses archives in all common formats (ZIP, TAR.GZ, TAR.BZ2, "
            "RAR, 7z, XZ) to a destination folder of your choice. It shows a live file tree "
            "preview before extraction and supports password-protected archives. "
            "All operations are local — no AI required."
        ),
        "categories": ["documents"],
        "fileExtensions": [".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".rar", ".7z", ".xz"],
        "usesAI": False,
        "icon": "Archive",
        "accentColor": "amber",
        "author": "Core Team",
        "fields": [
            {
                "key": "archiveFile",
                "label": "Archive File",
                "type": "file",
                "description": "The compressed archive to extract.",
                "required": True,
                "acceptedExtensions": [".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".rar", ".7z", ".xz"],
            },
            {
                "key": "outputDirectory",
                "label": "Output Directory",
                "type": "string",
                "description": "Destination path where files will be extracted.",
                "required": False,
                "default": "./extracted",
            },
            {
                "key": "password",
                "label": "Password",
                "type": "string",
                "description": "Password for encrypted archives (leave blank if not password-protected).",
                "required": False,
            },
            {
                "key": "overwrite",
                "label": "Overwrite Existing Files",
                "type": "boolean",
                "description": "Replace files that already exist in the output directory.",
                "required": False,
                "default": False,
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the Archive Extractor.",
            "Select or drag in the archive file.",
            "Set the output directory (defaults to ./extracted).",
            "Enter a password if the archive is encrypted.",
            "Click Extract and monitor the progress.",
            "Browse the extracted files in the output panel.",
        ],
        "tags": ["zip", "tar", "rar", "7z", "extract", "decompress", "archive"],
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
                "key": "inputFile",
                "label": "3D Model File",
                "type": "file",
                "description": "The 3D model to convert.",
                "required": True,
                "acceptedExtensions": [".obj", ".fbx", ".glb", ".gltf", ".stl", ".ply", ".dae"],
            },
            {
                "key": "outputFormat",
                "label": "Output Format",
                "type": "select",
                "description": "Target 3D model format.",
                "required": True,
                "options": ["obj", "fbx", "glb", "gltf", "stl", "ply"],
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
            "Select the 3D model file you want to convert.",
            "Choose the target format from the dropdown.",
            "Click Convert and wait for the conversion to complete.",
            "Download the converted model file.",
        ],
        "tags": ["3d", "convert", "obj", "fbx", "gltf", "glb", "stl", "assimp"],
    },

    {
        "id": "3d-analyzer",
        "name": "AI 3D Scene Analyzer",
        "version": "0.5.0",
        "description": "Describe the contents and suggest optimisations for 3D scenes using AI.",
        "longDescription": (
            "AI 3D Scene Analyzer renders key views of a 3D model file, then asks a multimodal AI "
            "to describe what it sees, estimate polygon counts, flag potential rendering issues "
            "(non-manifold geometry, inverted normals), and suggest LOD or texture optimisations. "
            "Great for QA in asset pipelines."
        ),
        "categories": ["3d"],
        "fileExtensions": [".obj", ".fbx", ".glb", ".gltf"],
        "usesAI": True,
        "icon": "ScanSearch",
        "accentColor": "cyan",
        "author": "AI Labs",
        "fields": [
            {
                "key": "modelFile",
                "label": "3D Model File",
                "type": "file",
                "description": "The 3D scene or model file to analyse.",
                "required": True,
                "acceptedExtensions": [".obj", ".fbx", ".glb", ".gltf"],
            },
            {
                "key": "analysisMode",
                "label": "Analysis Mode",
                "type": "select",
                "description": "What aspect of the model to focus on.",
                "required": False,
                "options": ["overview", "geometry", "materials", "optimisation"],
                "default": "overview",
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the AI 3D Scene Analyzer.",
            "Upload a 3D model in OBJ, FBX, or GLTF format.",
            "Select an analysis mode.",
            "Click Analyze and wait while the AI renders and inspects the scene.",
            "Read the AI-generated report with findings and optimisation tips.",
        ],
        "tags": ["3d", "AI", "analyze", "scene", "mesh", "LOD", "optimize", "quality"],
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

    {
        "id": "csv-importer",
        "name": "CSV → Database Importer",
        "version": "1.2.0",
        "description": "Import CSV files into a SQLite database with auto schema detection.",
        "longDescription": (
            "CSV Importer reads one or more CSV files, infers column types (integer, float, text, "
            "date), creates the appropriate table schema, and bulk-inserts the data into a "
            "target SQLite database. It handles malformed rows, encoding issues, and duplicate "
            "detection. A preview shows the detected schema before import."
        ),
        "categories": ["database", "documents"],
        "fileExtensions": [".csv", ".tsv"],
        "usesAI": False,
        "icon": "Table",
        "accentColor": "indigo",
        "author": "Core Team",
        "fields": [
            {
                "key": "csvFiles",
                "label": "CSV / TSV Files",
                "type": "multifile",
                "description": "One or more delimited text files to import.",
                "required": True,
                "acceptedExtensions": [".csv", ".tsv"],
            },
            {
                "key": "delimiter",
                "label": "Delimiter",
                "type": "select",
                "description": "Column separator used in the file.",
                "required": False,
                "options": ["comma", "semicolon", "tab", "pipe"],
                "default": "comma",
            },
            {
                "key": "targetDatabase",
                "label": "Target Database File",
                "type": "string",
                "description": "Path to the SQLite file to write to. Created if it does not exist.",
                "required": True,
                "default": "output.sqlite",
            },
            {
                "key": "skipDuplicates",
                "label": "Skip Duplicate Rows",
                "type": "boolean",
                "description": "Ignore rows that already exist in the table (based on primary key).",
                "required": False,
                "default": True,
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the CSV Importer.",
            "Select one or more CSV or TSV files.",
            "Verify the auto-detected schema in the preview.",
            "Set the target SQLite file path.",
            "Click Import and monitor the row-insertion progress.",
            "Open the resulting database in SQLite Viewer for verification.",
        ],
        "tags": ["csv", "import", "sqlite", "schema", "bulk", "data", "tsv"],
    },

    # ── PROGRAMMING ───────────────────────────────────────────────────────

    {
        "id": "code-formatter",
        "name": "Code Formatter",
        "version": "1.0.0",
        "description": "Format source files with Prettier, Black, gofmt, and other popular formatters.",
        "longDescription": (
            "Code Formatter detects the language of each file and runs the appropriate "
            "industry-standard formatter automatically: Prettier for JS/TS/CSS/HTML, "
            "Black for Python, gofmt for Go, rustfmt for Rust, and clang-format for C/C++. "
            "All formatters run locally; no AI is required."
        ),
        "categories": ["programming"],
        "fileExtensions": [
            ".js", ".ts", ".tsx", ".jsx", ".css", ".html",
            ".py", ".go", ".rs", ".c", ".cpp", ".h",
        ],
        "usesAI": False,
        "icon": "Code",
        "accentColor": "green",
        "author": "Core Team",
        "fields": [
            {
                "key": "sourceFiles",
                "label": "Source Files",
                "type": "multifile",
                "description": "Code files to format.",
                "required": True,
                "acceptedExtensions": [
                    ".js", ".ts", ".tsx", ".jsx", ".css", ".html",
                    ".py", ".go", ".rs", ".c", ".cpp", ".h",
                ],
            },
            {
                "key": "tabWidth",
                "label": "Tab Width",
                "type": "number",
                "description": "Number of spaces per indentation level (Prettier / Black).",
                "required": False,
                "default": 4,
            },
            {
                "key": "useTabs",
                "label": "Use Tabs",
                "type": "boolean",
                "description": "Indent with hard tabs instead of spaces.",
                "required": False,
                "default": False,
            },
        ],
        "usageSteps": [
            "Click \"Run Tool\" to open the Code Formatter.",
            "Select one or more source files.",
            "Adjust indentation preferences if needed.",
            "Click Format and review the diff.",
            "Apply changes to overwrite files or download formatted versions.",
        ],
        "tags": ["format", "prettier", "black", "gofmt", "lint", "style", "code"],
    },

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
]
