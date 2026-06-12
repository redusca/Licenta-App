"""
Audio Transcriber — transcribe speech from audio files to plain text using Whisper.

Sends the audio file to the AI Gateway's Whisper endpoint and saves the
transcript as a .txt file alongside the source or into a virtual drive.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import requests
import utils.ai_gateway as ai_gateway

SUPPORTED_INPUT_EXTENSIONS = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"}

DEFINITION = {
    "name": "audio_transcriber",
    "description": (
        "Transcribe speech from an audio file (MP3, WAV, OGG, FLAC, M4A, AAC) into a plain-text "
        "transcript using a Whisper-based speech recognition model. "
        "Saves the result as a .txt file. "
        "Use this when the user asks to: transcribe audio, convert speech to text, get a transcript "
        "of a recording, or save audio content as text."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "filePath": {
                "type": "string",
                "description": "Absolute path to the audio file (MP3, WAV, OGG, FLAC, M4A, or AAC).",
            },
            "language": {
                "type": "string",
                "description": (
                    "ISO-639-1 language code of the spoken audio (e.g. 'en', 'ro', 'fr'). "
                    "Use 'auto' or omit to let Whisper detect the language automatically."
                ),
            },
            "outputMode": {
                "type": "string",
                "enum": ["copy", "virtual_drive"],
                "description": (
                    "'copy' saves the .txt transcript in the same folder as the audio file (default). "
                    "'virtual_drive' saves it into a TranscriptResults folder at outputPath."
                ),
            },
            "outputPath": {
                "type": "string",
                "description": "Parent directory for the virtual drive — required only when outputMode is 'virtual_drive'.",
            },
        },
        "required": ["filePath"],
    },
    "input_instructions": (
        "filePath: use ask_user(input_type='file') to let the user pick the audio file. "
        "language: ask the user for the spoken language, or omit to auto-detect. "
        "outputMode: use 'copy' by default (saves .txt next to the audio); "
        "use 'virtual_drive' only if the user specifically wants it in a drive, then also set outputPath. "
        "If the user mentions a drive name, resolve it first with drive_list, then pass its path as outputPath "
        "and set outputMode to 'virtual_drive'."
    ),
    "output_description": (
        "JSON {success, transcription, outputPath, metrics}. "
        "outputPath is the absolute path to the saved .txt file (null if not saved)."
    ),
}


def execute(input_data: dict) -> str:
    file_path: str = input_data.get("filePath", "")
    language: str | None = input_data.get("language") or None
    if language == "auto":
        language = None
    output_mode: str = input_data.get("outputMode", "copy")
    output_path: str = input_data.get("outputPath", "")

    if not file_path or not os.path.isfile(file_path):
        return json.dumps({"success": False, "error": "File not found or invalid path."})

    ext = Path(file_path).suffix.lower()
    if ext not in SUPPORTED_INPUT_EXTENSIONS:
        return json.dumps({
            "success": False,
            "error": f"Unsupported file type '{ext}'. Supported: {', '.join(sorted(SUPPORTED_INPUT_EXTENSIONS))}",
        })

    gw_ok, gw_err = ai_gateway.health_check()
    if not gw_ok:
        return json.dumps({"success": False, "error": gw_err})

    try:
        with open(file_path, "rb") as fh:
            raw = fh.read()
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Cannot read file: {exc}"})

    form_data: dict = {"max_new_tokens": "256"}
    if language:
        form_data["language"] = language

    try:
        resp = requests.post(
            f"{ai_gateway.get_url()}/api/ai/transcribe/whisper",
            files={"file": (os.path.basename(file_path), raw)},
            data=form_data,
            headers=ai_gateway.auth_headers(),
            timeout=(10, 1200),
        )
        resp.raise_for_status()
        result = resp.json()
    except requests.exceptions.ConnectionError:
        return json.dumps({"success": False, "error": f"Lost connection to AI Gateway at {ai_gateway.get_url()}"})
    except requests.exceptions.Timeout:
        return json.dumps({"success": False, "error": "Request timed out — the model may still be loading. Try again in a moment."})
    except requests.exceptions.HTTPError as exc:
        detail = ""
        try:
            detail = exc.response.json().get("detail", "")
        except Exception:
            pass
        return json.dumps({"success": False, "error": f"AI Gateway error: {detail or str(exc)}"})
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)})

    transcription: str = result.get("transcription", "")
    out_file: str | None = None

    if output_mode in ("copy", "virtual_drive"):
        try:
            base_name = Path(file_path).stem
            out_filename = f"{base_name}_transcript.txt"
            if output_mode == "virtual_drive" and output_path:
                out_dir = os.path.join(output_path, "TranscriptResults")
                os.makedirs(out_dir, exist_ok=True)
            else:
                out_dir = os.path.dirname(file_path)
            out_file = os.path.join(out_dir, out_filename)
            with open(out_file, "w", encoding="utf-8") as fh:
                fh.write(transcription)
        except Exception as exc:
            out_file = None

    return json.dumps({
        "success": True,
        "transcription": transcription,
        "outputPath": out_file,
        "metrics": result.get("metrics", {}),
    }, ensure_ascii=False)
