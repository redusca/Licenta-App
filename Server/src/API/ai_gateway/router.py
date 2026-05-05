"""
AI Gateway — FastAPI Router.

Mounts all AI model endpoints under ``/api/ai``.

Endpoints
---------
GET   /api/ai/status                → gateway health + per-model readiness
POST  /api/ai/models/{name}/wake    → pre-load a specific model
POST  /api/ai/models/{name}/unload  → release a model's resources
POST  /api/ai/upscale/swin2sr       → super-resolve image ×2
POST  /api/ai/upscale/sd-x4         → super-resolve image ×4 (text-guided)
POST  /api/ai/transcribe/whisper    → transcribe audio to text
"""

from __future__ import annotations

import base64
import io
import logging
from typing import Any

import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from PIL import Image

from .models import Swin2SRModel, SDx4UpscalerModel, WhisperModel

logger = logging.getLogger(__name__)

# ── Singleton model instances ─────────────────────────────────────────────────
# Created once at import time; weights are loaded lazily on first request
# or explicitly via the /wake endpoint.

_swin2sr = Swin2SRModel()
_sd_x4 = SDx4UpscalerModel()
_whisper = WhisperModel()

_ALL_MODELS = {
    "swin2sr": _swin2sr,
    "sd-x4": _sd_x4,
    "whisper": _whisper,
}

# ── Pydantic schemas ──────────────────────────────────────────────────────────


class ModelStatusOut(BaseModel):
    name: str
    model_id: str
    task: str
    is_loaded: bool
    device: str


class GatewayStatusOut(BaseModel):
    status: str
    models: list[ModelStatusOut]


class WakeResponseOut(BaseModel):
    message: str
    model: ModelStatusOut


class UpscaleResponseOut(BaseModel):
    image_base64: str
    format: str
    metrics: dict[str, Any]


class TranscribeResponseOut(BaseModel):
    transcription: str
    metrics: dict[str, Any]


# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/ai", tags=["ai-gateway"])


# ---------- Status & management ----------


@router.get("/status", response_model=GatewayStatusOut)
async def gateway_status():
    """Return readiness of every registered model."""
    models = []
    for m in _ALL_MODELS.values():
        info = m.model_info
        models.append(
            ModelStatusOut(
                name=info.name,
                model_id=info.model_id,
                task=info.task,
                is_loaded=info.is_loaded,
                device=info.device,
            )
        )
    return GatewayStatusOut(status="ok", models=models)


@router.post("/models/{name}/wake", response_model=WakeResponseOut)
async def wake_model(name: str):
    """Pre-load a model into memory.

    Accepted names: ``swin2sr``, ``sd-x4``, ``whisper``.
    """
    model = _ALL_MODELS.get(name)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown model '{name}'. Available: {list(_ALL_MODELS.keys())}",
        )
    await model.ensure_loaded()
    info = model.model_info
    return WakeResponseOut(
        message=f"Model {info.name} is ready",
        model=ModelStatusOut(
            name=info.name,
            model_id=info.model_id,
            task=info.task,
            is_loaded=info.is_loaded,
            device=info.device,
        ),
    )


@router.post("/models/{name}/unload", status_code=status.HTTP_204_NO_CONTENT)
async def unload_model(name: str):
    """Release a model's GPU / RAM resources."""
    model = _ALL_MODELS.get(name)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown model '{name}'. Available: {list(_ALL_MODELS.keys())}",
        )
    await model.safe_unload()


# ---------- Swin2SR — Image Super-Resolution ×2 ----------


@router.post("/upscale/swin2sr", response_model=UpscaleResponseOut)
async def upscale_swin2sr(
    file: UploadFile = File(..., description="Low-resolution image (PNG / JPEG / WEBP)"),
):
    """Super-resolve an image ×2 using Swin2SR.

    Upload a low-resolution image and receive a ×2 upscaled version
    encoded as base64, along with quality metrics.
    """
    image = await _read_upload_as_image(file)

    try:
        result = await _swin2sr.process(image=image)
    except Exception as exc:
        logger.exception("Swin2SR inference failed")
        raise HTTPException(status_code=500, detail=f"Swin2SR error: {exc}")

    img_b64 = _pil_to_base64(result["sr_image"])
    return UpscaleResponseOut(image_base64=img_b64, format="png", metrics=result["metrics"])


# ---------- SD ×4 Upscaler — Text-Guided Super-Resolution ×4 ----------


@router.post("/upscale/sd-x4", response_model=UpscaleResponseOut)
async def upscale_sd_x4(
    file: UploadFile = File(..., description="Low-resolution image"),
    prompt: str = Form("high quality, detailed", description="Text prompt to guide upscaling"),
    num_inference_steps: int = Form(25, ge=1, le=100, description="Denoising steps"),
    guidance_scale: float = Form(7.5, ge=1.0, le=20.0, description="Prompt guidance strength"),
    seed: int = Form(42, description="Random seed (-1 for random)"),
):
    """Super-resolve an image ×4 using Stable Diffusion (text-guided).

    This is a *generative* upscaler — it adds details based on the prompt.
    """
    image = await _read_upload_as_image(file)
    actual_seed = seed if seed >= 0 else None

    try:
        result = await _sd_x4.process(
            image=image,
            prompt=prompt,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            seed=actual_seed,
        )
    except Exception as exc:
        logger.exception("SD x4 Upscaler inference failed")
        raise HTTPException(status_code=500, detail=f"SD x4 Upscaler error: {exc}")

    img_b64 = _pil_to_base64(result["sr_image"])
    return UpscaleResponseOut(image_base64=img_b64, format="png", metrics=result["metrics"])


# ---------- Whisper — Speech-to-Text ----------


@router.post("/transcribe/whisper", response_model=TranscribeResponseOut)
async def transcribe_whisper(
    file: UploadFile = File(..., description="Audio file (WAV, MP3, FLAC, etc.)"),
    language: str = Form(None, description="ISO-639 language code (e.g. 'ro', 'en'). None = auto"),
    max_new_tokens: int = Form(256, ge=16, le=1024, description="Max tokens to generate"),
    expected_text: str = Form(None, description="Ground-truth text for WER/CER (optional)"),
):
    """Transcribe an audio file using Whisper Large V3.

    Supports WAV, MP3, FLAC, OGG, and most common audio formats.
    Returns the transcription text and performance metrics.
    """
    audio_array, sample_rate = await _read_upload_as_audio(file)

    try:
        result = await _whisper.process(
            audio=audio_array,
            sample_rate=sample_rate,
            language=language or None,
            max_new_tokens=max_new_tokens,
            expected_text=expected_text or None,
        )
    except Exception as exc:
        logger.exception("Whisper inference failed")
        raise HTTPException(status_code=500, detail=f"Whisper error: {exc}")

    return TranscribeResponseOut(
        transcription=result["transcription"],
        metrics=result["metrics"],
    )


# ── File-reading helpers ──────────────────────────────────────────────────────


async def _read_upload_as_image(upload: UploadFile) -> Image.Image:
    """Read an uploaded file into a PIL Image."""
    contents = await upload.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    try:
        return Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode image file")


async def _read_upload_as_audio(upload: UploadFile) -> tuple[np.ndarray, int]:
    """Read an uploaded audio file into a float32 numpy array + sample rate.

    Requires ``soundfile`` (preferred) or falls back to ``pydub``.
    """
    contents = await upload.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    buf = io.BytesIO(contents)

    # Try soundfile first (fast, supports WAV/FLAC/OGG)
    try:
        import soundfile as sf
        audio, sr = sf.read(buf, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)  # stereo → mono
        # Resample to 16 kHz if needed
        if sr != 16_000:
            audio = _resample(audio, sr, 16_000)
            sr = 16_000
        return audio, sr
    except Exception:
        pass

    # Fallback: pydub (supports MP3 and everything FFmpeg can handle)
    try:
        from pydub import AudioSegment
        buf.seek(0)
        seg = AudioSegment.from_file(buf)
        seg = seg.set_channels(1).set_frame_rate(16_000).set_sample_width(2)
        samples = np.array(seg.get_array_of_samples(), dtype=np.float32)
        samples /= 32768.0  # int16 → float32
        return samples, 16_000
    except Exception:
        pass

    raise HTTPException(
        status_code=400,
        detail="Could not decode audio file. Supported: WAV, FLAC, MP3, OGG.",
    )


def _resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """Simple linear-interpolation resampler (good enough for Whisper)."""
    duration = len(audio) / orig_sr
    target_len = int(duration * target_sr)
    indices = np.linspace(0, len(audio) - 1, target_len)
    return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)


def _pil_to_base64(img: Image.Image, fmt: str = "PNG") -> str:
    """Encode a PIL Image to a base64 string."""
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode("utf-8")
