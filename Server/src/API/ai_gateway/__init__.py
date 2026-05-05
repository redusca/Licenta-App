"""
AI Gateway — Unified API for all AI models.

This package provides a centralized gateway that exposes every AI model
through a single FastAPI router.  Each model is wrapped in its own class
with a standard interface (wake → process → unload), and the gateway
composes them behind clean REST endpoints.

Models
------
• Swin2SR          — Image super-resolution ×2  (caidas/swin2SR-classical-sr-x2-64)
• SD x4 Upscaler   — Image super-resolution ×4  (stabilityai/stable-diffusion-x4-upscaler)
• Whisper Large V3  — Speech-to-text ASR         (openai/whisper-large-v3)

Endpoints (mounted on ``/api/ai``)
----------------------------------
GET   /status               → health + per-model readiness
POST  /upscale/swin2sr      → super-resolve an image ×2
POST  /upscale/sd-x4        → super-resolve an image ×4 (text-guided)
POST  /transcribe/whisper   → transcribe audio to text
"""
