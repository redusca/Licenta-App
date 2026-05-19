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
        "Generate an SRT subtitle file from a video. "
        "Whisper transcribes the audio with timestamps; optionally translates subtitles "
        "to another language using Google Translate."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "videoPath": {"type": "string", "description": "Absolute path to the video file."},
            "sourceLanguage": {
                "type": "string",
                "description": "ISO-639 language of the video audio (e.g. 'en', 'ro'). Use 'auto' to auto-detect.",
            },
            "translateTo": {
                "type": "string",
                "description": "ISO-639 language code to translate subtitles into. Empty string = no translation.",
            },
            "outputMode": {
                "type": "string",
                "enum": ["copy", "virtual_drive"],
                "description": "'copy' saves .srt next to the video; 'virtual_drive' saves to output path.",
            },
            "outputPath": {
                "type": "string",
                "description": "Required when outputMode is 'virtual_drive'.",
            },
        },
        "required": ["videoPath"],
    },
    "input_instructions": (
        "videoPath: use ask_user(input_type='file') to let the user pick a video. "
        "sourceLanguage: ask the user or use 'auto'. "
        "translateTo: ask the user which language to translate into, or leave empty to keep original language."
    ),
    "output_description": "JSON {success, srtPath, numSegments, metrics}",
}
