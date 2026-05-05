"""
Stable Diffusion ×4 Upscaler — Text-Guided Super-Resolution.

Uses ``stabilityai/stable-diffusion-x4-upscaler`` via HuggingFace diffusers.
This is a *generative* model: it takes a low-resolution image **and** a text
prompt, then produces a ×4 upscaled result guided by the prompt.

Key differences from Swin2SR:
    • Generative (latent diffusion) — adds details that weren't in the input
    • Requires a text prompt
    • Much slower (iterative denoising steps)
    • Much higher VRAM usage (~5-7 GB)
"""

from __future__ import annotations

import asyncio
import gc
import logging
import time
from typing import Any

import numpy as np
from PIL import Image, ImageFilter

from ..base_model import BaseAIModel

logger = logging.getLogger(__name__)

MODEL_ID = "stabilityai/stable-diffusion-x4-upscaler"
SCALE_FACTOR = 4
DEFAULT_STEPS = 25
DEFAULT_GUIDANCE = 7.5


class SDx4UpscalerModel(BaseAIModel):
    """Stable Diffusion ×4 text-guided upscaler adapter."""

    def __init__(self) -> None:
        super().__init__(
            name="SD-x4-Upscaler",
            model_id=MODEL_ID,
            task="image-super-resolution-x4",
        )
        self._pipe = None

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def wake_up(self) -> None:
        """Download / load the Stable Diffusion upscale pipeline."""

        def _load():
            import torch
            from diffusers import StableDiffusionUpscalePipeline

            device = "cuda" if torch.cuda.is_available() else "cpu"
            dtype = torch.float32  # float32 avoids NaN / black-output issues

            pipe = StableDiffusionUpscalePipeline.from_pretrained(
                MODEL_ID,
                torch_dtype=dtype,
            )
            pipe = pipe.to(device)
            pipe.enable_attention_slicing()   # lower VRAM peak

            # Disable safety checker — it false-positives on synthetic images
            pipe.safety_checker = None
            if hasattr(pipe, "watermark"):
                pipe.watermark = None

            return pipe, device

        self._pipe, self._device = await asyncio.to_thread(_load)

    async def process(
        self,
        *,
        image: Image.Image,
        prompt: str = "high quality, detailed",
        num_inference_steps: int = DEFAULT_STEPS,
        guidance_scale: float = DEFAULT_GUIDANCE,
        seed: int | None = 42,
    ) -> dict[str, Any]:
        """Upscale an image ×4 with text guidance.

        Parameters
        ----------
        image : PIL.Image.Image
            Low-resolution input (RGB).
        prompt : str
            Text prompt guiding the generation.
        num_inference_steps : int
            Number of denoising steps (more = better quality, slower).
        guidance_scale : float
            How strongly to follow the prompt.
        seed : int | None
            Random seed for reproducibility.

        Returns
        -------
        dict with keys:
            sr_image   — PIL.Image (upscaled)
            metrics    — performance / quality numbers
        """
        if not self._is_loaded:
            await self.ensure_loaded()

        def _infer():
            import torch

            generator = None
            if seed is not None:
                generator = torch.Generator(device=self._device).manual_seed(seed)

            if torch.cuda.is_available():
                torch.cuda.reset_peak_memory_stats()

            t0 = time.perf_counter()
            raw_output = self._pipe(
                prompt=prompt,
                image=image.convert("RGB"),
                num_inference_steps=num_inference_steps,
                guidance_scale=guidance_scale,
                generator=generator,
            )
            inference_time = time.perf_counter() - t0

            gpu_peak = 0
            if torch.cuda.is_available():
                gpu_peak = torch.cuda.max_memory_allocated() / (1024 ** 2)

            sr_img = raw_output.images[0]
            # Clamp to valid range (VAE can produce slight outliers)
            sr_arr = np.clip(np.array(sr_img), 0, 255).astype(np.uint8)
            sr_img = Image.fromarray(sr_arr)

            return sr_img, inference_time, gpu_peak

        sr_image, inference_time, gpu_peak = await asyncio.to_thread(_infer)

        metrics = {
            "inference_time_s": round(inference_time, 4),
            "input_size": f"{image.size[0]}x{image.size[1]}",
            "output_size": f"{sr_image.size[0]}x{sr_image.size[1]}",
            "scale_factor": SCALE_FACTOR,
            "num_inference_steps": num_inference_steps,
            "guidance_scale": guidance_scale,
            "gpu_peak_mb": round(gpu_peak, 1),
            "device": self._device,
            **_no_ref_metrics(sr_image),
        }

        return {"sr_image": sr_image, "metrics": metrics}

    async def unload(self) -> None:
        del self._pipe
        self._pipe = None

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

    lap = gray.filter(
        ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], 1, 128)
    )
    sharpness = float(np.var(np.array(lap, dtype=np.float64) - 128.0))

    hist, _ = np.histogram(arr.flatten(), bins=256, range=(0, 255), density=True)
    hist = hist[hist > 0]
    entropy = float(-np.sum(hist * np.log2(hist)))

    contrast = float(np.std(arr))

    return {
        "sharpness": round(sharpness, 4),
        "entropy": round(entropy, 4),
        "contrast": round(contrast, 4),
    }
