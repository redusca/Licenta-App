"""
Subtitle Generator — extract audio from a video, transcribe with Whisper (timestamps),
optionally translate each segment, and produce an SRT subtitle file.

This module holds the agent DEFINITION and the pure SRT utility functions used by
the Flask streaming endpoint /api/tools/subtitle-generator/stream.
"""
from __future__ import annotations


# ── Pure SRT helpers ──────────────────────────────────────────────────────────

def srt_time(seconds: float) -> str:
    """Convert float seconds to SRT timestamp format: HH:MM:SS,mmm"""
    seconds = max(0.0, float(seconds))
    ms = int(round((seconds % 1) * 1000))
    # Clamp milliseconds that round up to 1000
    if ms >= 1000:
        seconds += 1.0
        ms = 0
    s = int(seconds) % 60
    m = (int(seconds) // 60) % 60
    h = int(seconds) // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(chunks: list[dict]) -> str:
    """Convert a list of Whisper timestamp chunks to an SRT subtitle string.

    Each chunk must have keys: ``text`` (str), ``start`` (float), ``end`` (float).
    Chunks with empty text are silently skipped.
    """
    lines: list[str] = []
    index = 1
    for seg in chunks:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        start = srt_time(seg.get("start", 0.0))
        end = srt_time(seg.get("end", 0.0))
        lines.append(f"{index}\n{start} --> {end}\n{text}")
        index += 1
    return "\n\n".join(lines) + ("\n" if lines else "")


DEFINITION = {
    "name": "subtitle_generator",
    "description": (
        "Generate an SRT subtitle file from a video by transcribing its audio with Whisper (timestamps included). "
        "Optionally translates the subtitles to another language using Google Translate. "
        "Supported video formats: MP4, MKV, AVI, MOV, WMV, FLV, WebM, M4V. "
        "Use this when the user asks to: add subtitles, transcribe a video, generate captions, "
        "or translate a video's speech."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "videoPath": {
                "type": "string",
                "description": "Absolute path to the video file (MP4, MKV, AVI, MOV, etc.).",
            },
            "sourceLanguage": {
                "type": "string",
                "description": (
                    "ISO-639-1 language code of the spoken audio (e.g. 'en', 'ro', 'fr', 'de', 'es'). "
                    "Use 'auto' to let Whisper detect the language automatically."
                ),
            },
            "translateTo": {
                "type": "string",
                "description": (
                    "ISO-639-1 code of the target language for translation (e.g. 'en', 'fr', 'ro'). "
                    "Leave empty or omit to keep subtitles in the original spoken language."
                ),
            },
            "outputMode": {
                "type": "string",
                "enum": ["copy", "virtual_drive"],
                "description": (
                    "'copy' saves the .srt file in the same folder as the video (default). "
                    "'virtual_drive' saves it into a new virtual drive at outputPath."
                ),
            },
            "outputPath": {
                "type": "string",
                "description": "Parent directory for the virtual drive — required only when outputMode is 'virtual_drive'.",
            },
        },
        "required": ["videoPath"],
    },
    "input_instructions": (
        "videoPath: use ask_user(input_type='file') to let the user pick the video file. "
        "sourceLanguage: ask the user for the spoken language, or pass 'auto' to detect automatically. "
        "translateTo: ask the user if they want subtitles in a different language; omit if no translation needed. "
        "outputMode: use 'copy' by default (saves .srt next to the video); "
        "use 'virtual_drive' only if the user specifically wants it in a drive, then also set outputPath."
    ),
    "output_description": (
        "JSON {success, srtPath, numSegments, metrics}. "
        "srtPath is the absolute path to the produced .srt file."
    ),
}
