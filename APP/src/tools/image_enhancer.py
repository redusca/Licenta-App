"""
Image Enhancer — upscale images using the Swin2SR super-resolution model on the AI Gateway.

Sends the image to the AI Gateway's upscale endpoint and saves the result
as a PNG alongside the source or into a virtual drive.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path

import requests
import utils.ai_gateway as ai_gateway

SUPPORTED_INPUT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

_MIME_MAP = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}

DEFINITION = {
    "name": "image_enhancer",
    "description": (
        "Upscale and enhance an image using an AI super-resolution model (Swin2SR). "
        "Produces a higher-resolution PNG with improved detail and reduced artefacts. "
        "Supported inputs: JPEG, PNG, WebP. "
        "Use this when the user asks to: upscale an image, increase resolution, enhance quality, "
        "or make an image larger / sharper."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "filePath": {
                "type": "string",
                "description": "Absolute path to the image file to enhance (JPEG, PNG, or WebP).",
            },
            "outputMode": {
                "type": "string",
                "enum": ["copy", "virtual_drive"],
                "description": (
                    "'copy' saves the upscaled PNG in the same folder as the source image (default). "
                    "'virtual_drive' saves it into an ImageEnhancerResults folder at outputPath."
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
        "filePath: use ask_user(input_type='file') to let the user pick the image file. "
        "outputMode: use 'copy' by default (saves upscaled PNG next to the original); "
        "use 'virtual_drive' only if the user specifically wants it in a drive, then also set outputPath. "
        "If the user mentions a drive name, resolve it first with drive_list, then pass its path as outputPath "
        "and set outputMode to 'virtual_drive'."
    ),
    "output_description": (
        "JSON {success, outputPath, metrics}. "
        "outputPath is the absolute path to the saved upscaled PNG file."
    ),
}


def execute(input_data: dict) -> str:
    file_path: str = input_data.get("filePath", "")
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

    mime = _MIME_MAP.get(ext, "image/png")

    try:
        with open(file_path, "rb") as fh:
            raw = fh.read()
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Cannot read file: {exc}"})

    try:
        resp = requests.post(
            f"{ai_gateway.get_url()}/api/ai/upscale/swin2sr",
            files={"file": (os.path.basename(file_path), raw, mime)},
            headers=ai_gateway.auth_headers(),
            timeout=(10, 900),
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

    try:
        img_bytes = base64.b64decode(result["image_base64"])
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Failed to decode upscaled image: {exc}"})

    base_name = Path(file_path).stem
    out_filename = f"{base_name}_upscaled.png"

    if output_mode == "virtual_drive" and output_path:
        out_dir = os.path.join(output_path, "ImageEnhancerResults")
        os.makedirs(out_dir, exist_ok=True)
    else:
        out_dir = os.path.dirname(file_path)

    out_file = os.path.join(out_dir, out_filename)
    try:
        with open(out_file, "wb") as fh:
            fh.write(img_bytes)
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Failed to save output: {exc}"})

    return json.dumps({
        "success": True,
        "outputPath": out_file,
        "metrics": result.get("metrics", {}),
    })
