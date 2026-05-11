"""
Swin2SR Model — Image Super-Resolution ×2.

Uses ``caidas/swin2SR-classical-sr-x2-64`` via HuggingFace Transformers.
The model takes a low-resolution RGB image and outputs a ×2 upscaled result.

Metrics exposed per call:
    • inference_time_s
    • input_size / output_size
    • sharpness, entropy, contrast (no-reference quality)
"""

from __future__ import annotations

import asyncio
import io
import logging
import time
from typing import Any

import numpy as np
from PIL import Image, ImageFilter

from ..base_model import BaseAIModel

logger = logging.getLogger(__name__)

MODEL_ID = "caidas/swin2SR-classical-sr-x2-64"
SCALE_FACTOR = 2


class Swin2SRModel(BaseAIModel):
    """Swin2SR ×2 image super-resolution adapter."""

    def __init__(self) -> None:
        super().__init__(
            name="Swin2SR",
            model_id=MODEL_ID,
            task="image-super-resolution-x2",
        )
        self._processor = None
        self._model = None

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def wake_up(self) -> None:
        """Download / load Swin2SR weights (runs blocking I/O in a thread)."""

        def _load():
            import torch
            from transformers import AutoImageProcessor, Swin2SRForImageSuperResolution

            device = "cuda" if torch.cuda.is_available() else "cpu"
            processor = AutoImageProcessor.from_pretrained(MODEL_ID)
            model = Swin2SRForImageSuperResolution.from_pretrained(MODEL_ID).to(device)
            model.eval()
            return processor, model, device

        self._processor, self._model, self._device = await asyncio.to_thread(_load)

    async def process(self, *, image: Image.Image) -> dict[str, Any]:
        """Super-resolve a single PIL Image.

        Parameters
        ----------
        image : PIL.Image.Image
            Low-resolution input (RGB).

        Returns
        -------
        dict with keys:
            sr_image   — PIL.Image (upscaled)
            metrics    — dict of quality / perf numbers
        """
        if not self._is_loaded:
            await self.ensure_loaded()

        def _infer(img: Image.Image):
            import torch

            img_rgb = img.convert("RGB")

            # Swin2SR on CPU is O(n²) in patch count — cap to keep inference < ~3 min.
            # On CUDA there's no size limit.
            MAX_CPU_DIM = 512
            orig_size = img_rgb.size
            if self._device == "cpu" and max(img_rgb.size) > MAX_CPU_DIM:
                ratio = MAX_CPU_DIM / max(img_rgb.size)
                new_w = max(1, int(img_rgb.size[0] * ratio))
                new_h = max(1, int(img_rgb.size[1] * ratio))
                img_rgb = img_rgb.resize((new_w, new_h), Image.LANCZOS)
                logger.warning(
                    "CPU mode: resized %dx%d → %dx%d (MAX_CPU_DIM=%d)",
                    orig_size[0], orig_size[1], new_w, new_h, MAX_CPU_DIM,
                )

            inputs = self._processor(images=img_rgb, return_tensors="pt")
            pixel_values = inputs["pixel_values"].to(self._device)

            t0 = time.perf_counter()
            with torch.no_grad():
                output = self._model(pixel_values)
            inference_time = time.perf_counter() - t0

            # Post-process: squeeze, clamp, transpose
            sr_tensor = output.reconstruction.squeeze(0).clamp(0, 1)
            sr_np = (sr_tensor.cpu().numpy().transpose(1, 2, 0) * 255).astype(np.uint8)
            sr_pil = Image.fromarray(sr_np)

            return sr_pil, inference_time

        sr_image, inference_time = await asyncio.to_thread(_infer, image)

        metrics = {
            "inference_time_s": round(inference_time, 4),
            "input_size": f"{image.size[0]}x{image.size[1]}",
            "output_size": f"{sr_image.size[0]}x{sr_image.size[1]}",
            "scale_factor": SCALE_FACTOR,
            "device": self._device,
            **_no_ref_metrics(sr_image),
        }

        return {"sr_image": sr_image, "metrics": metrics}

    async def unload(self) -> None:
        import gc

        del self._model
        del self._processor
        self._model = None
        self._processor = None

        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

        gc.collect()


# ── No-Reference Quality Helpers ──────────────────────────────────────────────

def _no_ref_metrics(img: Image.Image) -> dict[str, float]:
    """Compute lightweight no-reference quality metrics."""
    gray = img.convert("L")
    arr = np.array(gray, dtype=np.float64)

    # Sharpness (Laplacian variance)
    lap = gray.filter(
        ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], 1, 128)
    )
    sharpness = float(np.var(np.array(lap, dtype=np.float64) - 128.0))

    # Shannon entropy
    hist, _ = np.histogram(arr.flatten(), bins=256, range=(0, 255), density=True)
    hist = hist[hist > 0]
    entropy = float(-np.sum(hist * np.log2(hist)))

    # Contrast (std of luminance)
    contrast = float(np.std(arr))

    return {
        "sharpness": round(sharpness, 4),
        "entropy": round(entropy, 4),
        "contrast": round(contrast, 4),
    }
