"""
Whisper Large V3 — Automatic Speech Recognition (ASR).

Uses ``openai/whisper-large-v3`` via HuggingFace Transformers.
Accepts raw audio (numpy float32 array at 16 kHz) and returns a
text transcription with timing metadata.

Features:
    • Multi-language (auto-detect or force via ``language`` param)
    • Returns Real-Time Factor (RTF) — < 1.0 means faster than real-time
    • Word Error Rate / Character Error Rate when ground-truth is provided
"""

from __future__ import annotations

import asyncio
import gc
import logging
import time
from typing import Any

import numpy as np

from ..base_model import BaseAIModel

logger = logging.getLogger(__name__)

MODEL_ID = "openai/whisper-large-v3-turbo"
TARGET_SAMPLE_RATE = 16_000


class WhisperModel(BaseAIModel):
    """Whisper Large V3 speech-to-text adapter."""

    def __init__(self) -> None:
        super().__init__(
            name="Whisper-Large-V3",
            model_id=MODEL_ID,
            task="automatic-speech-recognition",
        )
        self._pipeline = None

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def wake_up(self) -> None:
        """Download / load Whisper weights."""

        def _load():
            import torch
            from transformers import pipeline

            device = 0 if torch.cuda.is_available() else -1  # 0 = first GPU, -1 = CPU
            dtype = torch.float16 if torch.cuda.is_available() else torch.float32

            pipe = pipeline(
                "automatic-speech-recognition",
                model=MODEL_ID,
                torch_dtype=dtype,
                device=device,
            )
            device_str = "cuda" if torch.cuda.is_available() else "cpu"
            return pipe, device_str

        self._pipeline, self._device = await asyncio.to_thread(_load)

    async def process(
        self,
        *,
        audio: np.ndarray,
        sample_rate: int = TARGET_SAMPLE_RATE,
        language: str | None = None,
        max_new_tokens: int = 256,
        expected_text: str | None = None,
    ) -> dict[str, Any]:
        """Transcribe an audio array.

        Parameters
        ----------
        audio : np.ndarray
            Float32 waveform, mono, ideally 16 kHz.
        sample_rate : int
            Sample rate of the input audio.
        language : str | None
            ISO-639 language code (e.g. ``"ro"``).  ``None`` = auto-detect.
        max_new_tokens : int
            Maximum tokens the decoder will generate.
        expected_text : str | None
            Ground-truth transcription (for WER/CER computation).

        Returns
        -------
        dict with keys:
            transcription — str
            metrics       — dict of perf / accuracy numbers
        """
        if not self._is_loaded:
            await self.ensure_loaded()

        def _infer():
            import torch

            if torch.cuda.is_available():
                torch.cuda.reset_peak_memory_stats()

            generate_kwargs: dict[str, Any] = {"max_new_tokens": max_new_tokens}
            if language:
                generate_kwargs["language"] = language

            t0 = time.perf_counter()
            output = self._pipeline(
                {"array": audio, "sampling_rate": sample_rate},
                generate_kwargs=generate_kwargs,
                return_timestamps=False,
            )
            inference_time = time.perf_counter() - t0

            gpu_peak = 0
            if torch.cuda.is_available():
                gpu_peak = torch.cuda.max_memory_allocated() / (1024 ** 2)

            transcription = output["text"].strip()
            num_tokens = len(transcription.split())  # approximate

            return transcription, inference_time, gpu_peak, num_tokens

        transcription, inference_time, gpu_peak, num_tokens = await asyncio.to_thread(_infer)

        duration_s = len(audio) / sample_rate
        rtf = inference_time / duration_s if duration_s > 0 else 0

        metrics: dict[str, Any] = {
            "inference_time_s": round(inference_time, 4),
            "audio_duration_s": round(duration_s, 2),
            "rtf": round(rtf, 4),
            "num_tokens": num_tokens,
            "gpu_peak_mb": round(gpu_peak, 1),
            "device": self._device,
            "sample_rate": sample_rate,
            "audio_rms": round(float(np.sqrt(np.mean(audio ** 2))), 6),
            "audio_peak": round(float(np.max(np.abs(audio))), 6),
        }

        if expected_text:
            metrics["wer"] = round(_word_error_rate(expected_text, transcription), 4)
            metrics["cer"] = round(_char_error_rate(expected_text, transcription), 4)

        return {"transcription": transcription, "metrics": metrics}

    async def process_with_timestamps(
        self,
        *,
        audio: np.ndarray,
        sample_rate: int = TARGET_SAMPLE_RATE,
        language: str | None = None,
        max_new_tokens: int = 444,
    ) -> dict[str, Any]:
        """Transcribe audio returning timed chunks suitable for subtitle files.

        Returns
        -------
        dict with keys:
            chunks  — list of {"text": str, "start": float, "end": float}
            metrics — dict of performance numbers
        """
        if not self._is_loaded:
            await self.ensure_loaded()

        def _infer_ts():
            import torch

            if torch.cuda.is_available():
                torch.cuda.reset_peak_memory_stats()

            generate_kwargs: dict[str, Any] = {"max_new_tokens": max_new_tokens}
            if language:
                generate_kwargs["language"] = language

            t0 = time.perf_counter()
            output = self._pipeline(
                {"array": audio, "sampling_rate": sample_rate},
                generate_kwargs=generate_kwargs,
                return_timestamps=True,
                chunk_length_s=30,   # sliding-window long-form: process full audio
                stride_length_s=6,   # 6 s overlap so words at boundaries aren't lost
            )
            inference_time = time.perf_counter() - t0

            gpu_peak = 0
            if torch.cuda.is_available():
                gpu_peak = torch.cuda.max_memory_allocated() / (1024 ** 2)

            raw_chunks = output.get("chunks") or []
            chunks = []
            for chunk in raw_chunks:
                ts = chunk.get("timestamp") or (0.0, 0.0)
                start = float(ts[0]) if ts[0] is not None else 0.0
                end = float(ts[1]) if len(ts) > 1 and ts[1] is not None else start + 2.0
                text = chunk.get("text", "").strip()
                if text:
                    chunks.append({"text": text, "start": round(start, 3), "end": round(end, 3)})

            return chunks, inference_time, gpu_peak

        chunks, inference_time, gpu_peak = await asyncio.to_thread(_infer_ts)

        duration_s = len(audio) / sample_rate
        rtf = inference_time / duration_s if duration_s > 0 else 0

        metrics: dict[str, Any] = {
            "inference_time_s": round(inference_time, 4),
            "audio_duration_s": round(duration_s, 2),
            "rtf": round(rtf, 4),
            "num_chunks": len(chunks),
            "gpu_peak_mb": round(gpu_peak, 1),
            "device": self._device,
        }

        return {"chunks": chunks, "metrics": metrics}

    async def unload(self) -> None:
        del self._pipeline
        self._pipeline = None

        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

        gc.collect()


# ── Error-Rate Helpers ────────────────────────────────────────────────────────

def _word_error_rate(ref: str, hyp: str) -> float:
    """WER via Levenshtein distance on word tokens."""
    if not ref:
        return 0.0 if not hyp else 1.0
    r, h = ref.split(), hyp.split()
    d = np.zeros((len(r) + 1, len(h) + 1), dtype=int)
    for i in range(len(r) + 1):
        d[i][0] = i
    for j in range(len(h) + 1):
        d[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            cost = 0 if r[i - 1] == h[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    return d[len(r)][len(h)] / len(r)


def _char_error_rate(ref: str, hyp: str) -> float:
    """CER via Levenshtein distance on characters."""
    if not ref:
        return 0.0 if not hyp else 1.0
    r, h = list(ref), list(hyp)
    d = np.zeros((len(r) + 1, len(h) + 1), dtype=int)
    for i in range(len(r) + 1):
        d[i][0] = i
    for j in range(len(h) + 1):
        d[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            cost = 0 if r[i - 1] == h[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    return d[len(r)][len(h)] / len(r)
