"""
AI Gateway — FastAPI Router.

Mounts all AI model endpoints under ``/api/ai``.

Endpoints
---------
GET   /api/ai/status                → gateway health + per-model readiness
POST  /api/ai/models/{name}/wake    → pre-load a specific model
POST  /api/ai/models/{name}/unload  → release a model's resources
POST  /api/ai/upscale/swin2sr       → super-resolve image ×2
POST  /api/ai/transcribe/whisper    → transcribe audio to text
"""

from __future__ import annotations

import base64
import io
import json as _json
import logging
import os
from typing import Any

import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from PIL import Image

from .models import Swin2SRModel, WhisperModel
from config import settings

logger = logging.getLogger(__name__)

# ── Singleton model instances ─────────────────────────────────────────────────
# Created once at import time; weights are loaded lazily on first request
# or explicitly via the /wake endpoint.

_swin2sr = Swin2SRModel()
_whisper = WhisperModel()

_ALL_MODELS = {
    "swin2sr": _swin2sr,
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
    try:
        await model.ensure_loaded()
    except Exception as exc:
        logger.exception("Failed to wake model '%s'", name)
        raise HTTPException(status_code=500, detail=f"Failed to load model '{name}': {exc}")
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


# ---------- Swin2SR — streaming SSE ----------


@router.post("/upscale/swin2sr/stream")
async def upscale_swin2sr_stream(
    file: UploadFile = File(..., description="Low-resolution image (PNG / JPEG / WEBP)"),
):
    """Super-resolve ×2 with Swin2SR, streaming progress via Server-Sent Events.

    Events emitted::

        data: {"stage":"loading_model","message":"...","progress":0.05}
        data: {"stage":"inference",    "message":"...","progress":0.4}
        data: {"stage":"postprocess",  "message":"...","progress":0.9}
        data: {"stage":"done","progress":1.0,"image_base64":"...","metrics":{...}}
        data: {"stage":"error","message":"..."}   # on failure
    """
    image = await _read_upload_as_image(file)

    async def _gen():
        def _evt(data: dict) -> str:
            return f"data: {_json.dumps(data)}\n\n"

        already_loaded = _swin2sr.model_info.is_loaded
        if already_loaded:
            yield _evt({"stage": "loading_model", "message": "Swin2SR already loaded — preparing inference...", "progress": 0.3})
        else:
            yield _evt({"stage": "loading_model", "message": "Loading Swin2SR weights (first run ~2 min)...", "progress": 0.05})

        try:
            await _swin2sr.ensure_loaded()
        except Exception as exc:
            yield _evt({"stage": "error", "message": f"Failed to load model: {exc}"})
            return

        if not already_loaded:
            yield _evt({"stage": "loading_model", "message": "Swin2SR model ready", "progress": 0.35})

        _device = _swin2sr.model_info.device
        if _device == "cpu":
            yield _evt({
                "stage": "inference",
                "message": "Running on CPU — image will be capped at 512 px, inference ~30–120 s...",
                "progress": 0.4,
            })
        else:
            yield _evt({"stage": "inference", "message": f"Running super-resolution ×2 on {_device}...", "progress": 0.4})

        try:
            result = await _swin2sr.process(image=image)
        except Exception as exc:
            yield _evt({"stage": "error", "message": f"Inference failed: {exc}"})
            return

        yield _evt({"stage": "postprocess", "message": "Encoding output image...", "progress": 0.9})
        img_b64 = _pil_to_base64(result["sr_image"])

        yield _evt({
            "stage": "done",
            "progress": 1.0,
            "image_base64": img_b64,
            "format": "png",
            "metrics": result["metrics"],
        })

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------- Whisper — streaming SSE ----------


@router.post("/transcribe/whisper/stream")
async def transcribe_whisper_stream(
    file: UploadFile = File(..., description="Audio file (WAV, MP3, FLAC, etc.)"),
    language: str = Form(None, description="ISO-639 language code. None = auto"),
    max_new_tokens: int = Form(256, ge=16, le=1024),
    expected_text: str = Form(None, description="Ground-truth text for WER/CER (optional)"),
):
    """Transcribe audio with Whisper Large V3, streaming progress via Server-Sent Events.

    Events::

        data: {"stage":"loading_model","message":"...","progress":0.05}
        data: {"stage":"inference",    "message":"...","progress":0.4}
        data: {"stage":"done","progress":1.0,"transcription":"...","metrics":{...}}
        data: {"stage":"error","message":"..."}
    """
    audio_array, sample_rate = await _read_upload_as_audio(file)

    async def _gen():
        def _evt(data: dict) -> str:
            return f"data: {_json.dumps(data)}\n\n"

        already_loaded = _whisper.model_info.is_loaded
        if already_loaded:
            yield _evt({"stage": "loading_model", "message": "Whisper already loaded — preprocessing audio...", "progress": 0.25})
        else:
            yield _evt({"stage": "loading_model", "message": "Loading Whisper Large V3 (~3 GB, first run ~3 min)...", "progress": 0.05})

        try:
            await _whisper.ensure_loaded()
        except Exception as exc:
            yield _evt({"stage": "error", "message": f"Failed to load model: {exc}"})
            return

        duration_s = len(audio_array) / sample_rate
        if not already_loaded:
            yield _evt({"stage": "loading_model", "message": f"Whisper ready — audio duration: {duration_s:.1f} s", "progress": 0.3})

        _wdev = _whisper.model_info.device
        _infer_note = " (CPU — may take several minutes)" if _wdev == "cpu" else f" on {_wdev}"
        yield _evt({"stage": "inference", "message": f"Transcribing {duration_s:.1f} s of audio{_infer_note}...", "progress": 0.4})

        try:
            result = await _whisper.process(
                audio=audio_array,
                sample_rate=sample_rate,
                language=language or None,
                max_new_tokens=max_new_tokens,
                expected_text=expected_text or None,
            )
        except Exception as exc:
            yield _evt({"stage": "error", "message": f"Transcription failed: {exc}"})
            return

        yield _evt({
            "stage": "done",
            "progress": 1.0,
            "transcription": result["transcription"],
            "metrics": result["metrics"],
        })

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------- Whisper — subtitle SSE (with timestamps) ----------


@router.post("/subtitle/whisper/stream")
async def subtitle_whisper_stream(
    file: UploadFile = File(..., description="Audio file extracted from video (WAV, MP3, etc.)"),
    language: str = Form(None, description="ISO-639 source language code. None = auto"),
    max_new_tokens: int = Form(444, ge=16, le=444),
):
    """Transcribe audio with timestamps for SRT subtitle generation, streaming SSE progress.

    Events::

        data: {"stage":"loading_model","message":"...","progress":0.05}
        data: {"stage":"inference",    "message":"...","progress":0.4}
        data: {"stage":"done","progress":1.0,"chunks":[{"text":"...","start":0.0,"end":2.5},...], "metrics":{...}}
        data: {"stage":"error","message":"..."}
    """
    audio_array, sample_rate = await _read_upload_as_audio(file)

    async def _gen():
        def _evt(data: dict) -> str:
            return f"data: {_json.dumps(data)}\n\n"

        already_loaded = _whisper.model_info.is_loaded
        if already_loaded:
            yield _evt({"stage": "loading_model", "message": "Whisper already loaded — preprocessing audio...", "progress": 0.25})
        else:
            yield _evt({"stage": "loading_model", "message": "Loading Whisper Large V3 (~3 GB, first run ~3 min)...", "progress": 0.05})

        try:
            await _whisper.ensure_loaded()
        except Exception as exc:
            yield _evt({"stage": "error", "message": f"Failed to load model: {exc}"})
            return

        duration_s = len(audio_array) / sample_rate
        if not already_loaded:
            yield _evt({"stage": "loading_model", "message": f"Whisper ready — audio: {duration_s:.1f} s", "progress": 0.3})

        _wdev = _whisper.model_info.device
        _note = " (CPU — may take several minutes)" if _wdev == "cpu" else f" on {_wdev}"
        yield _evt({"stage": "inference", "message": f"Transcribing {duration_s:.1f} s of audio with timestamps{_note}...", "progress": 0.4})

        try:
            result = await _whisper.process_with_timestamps(
                audio=audio_array,
                sample_rate=sample_rate,
                language=language or None,
                max_new_tokens=max_new_tokens,
            )
        except Exception as exc:
            yield _evt({"stage": "error", "message": f"Transcription failed: {exc}"})
            return

        yield _evt({
            "stage": "done",
            "progress": 1.0,
            "chunks": result["chunks"],
            "metrics": result["metrics"],
        })

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── LLM Gateway (Groq — same model as planning agent) ────────────────────────


class LLMRequest(BaseModel):
    prompt: str
    system: str | None = None
    temperature: float = 0.7
    max_output_tokens: int = 2048


class LLMResponse(BaseModel):
    text: str
    model: str
    latency_s: float


def _groq_api_key() -> str:
    """Resolve the Groq API key — settings first, then KEY env var (same as planning agent)."""
    return settings.GROQ_API_KEY or os.environ.get("KEY", "")


def _get_groq_client():
    from groq import AsyncGroq
    api_key = _groq_api_key()
    if not api_key:
        raise RuntimeError("No Groq API key found. Set GROQ_API_KEY (or KEY) in .env")
    return AsyncGroq(api_key=api_key)


@router.get("/llm/status")
async def llm_status():
    """Return whether the Groq LLM is reachable (API key configured)."""
    api_key = _groq_api_key()
    configured = bool(api_key)
    return {
        "configured": configured,
        "model": settings.GROQ_MODEL,
        "detail": "Groq API key is set" if configured else "No API key found (set GROQ_API_KEY or KEY in .env)",
    }


@router.post("/llm/generate", response_model=LLMResponse)
async def llm_generate(body: LLMRequest):
    """Send a prompt to the Groq LLM and return the full text response.

    Uses the same model (``settings.GROQ_MODEL``) and API key the planning
    agent uses, so no extra credentials are needed.

    Body
    ----
    prompt : str
        The user prompt.
    system : str | None
        Optional system / instruction prefix.
    temperature : float
        Sampling temperature (default 0.7).
    max_output_tokens : int
        Maximum tokens in the reply (default 2048).
    """
    import time

    try:
        client = _get_groq_client()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    messages: list[dict] = []
    if body.system:
        messages.append({"role": "system", "content": body.system})
    messages.append({"role": "user", "content": body.prompt})

    t0 = time.perf_counter()
    try:
        resp = await client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=messages,
            temperature=body.temperature,
            max_completion_tokens=body.max_output_tokens,
            stream=False,
        )
    except Exception as exc:
        logger.exception("LLM generate failed")
        raise HTTPException(status_code=500, detail=f"LLM error: {exc}")
    latency = round(time.perf_counter() - t0, 3)

    text = resp.choices[0].message.content or ""
    return LLMResponse(text=text, model=settings.GROQ_MODEL, latency_s=latency)


@router.post("/llm/stream")
async def llm_stream(body: LLMRequest):
    """Stream a Groq LLM response token-by-token via Server-Sent Events.

    Events emitted::

        data: {"stage":"token",  "text":"<new token>", "accumulated":"<full so far>"}
        data: {"stage":"done",   "text":"<full reply>", "model":"...", "latency_s":0.5}
        data: {"stage":"error",  "message":"..."}
    """
    import time

    try:
        client = _get_groq_client()
    except RuntimeError as exc:
        async def _err():
            yield f'data: {_json.dumps({"stage": "error", "message": str(exc)})}\n\n'
        return StreamingResponse(_err(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    messages: list[dict] = []
    if body.system:
        messages.append({"role": "system", "content": body.system})
    messages.append({"role": "user", "content": body.prompt})

    async def _gen():
        t0 = time.perf_counter()
        accumulated = ""
        try:
            stream = await client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=messages,
                temperature=body.temperature,
                max_completion_tokens=body.max_output_tokens,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    accumulated += delta
                    yield f'data: {_json.dumps({"stage": "token", "text": delta, "accumulated": accumulated})}\n\n'
            latency = round(time.perf_counter() - t0, 3)
            yield f'data: {_json.dumps({"stage": "done", "text": accumulated, "model": settings.GROQ_MODEL, "latency_s": latency})}\n\n'
        except Exception as exc:
            logger.exception("LLM stream failed")
            yield f'data: {_json.dumps({"stage": "error", "message": str(exc)})}\n\n'

    return StreamingResponse(_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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
