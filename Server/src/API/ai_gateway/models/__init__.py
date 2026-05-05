"""
AI models sub-package.

Re-exports every model adapter so the gateway router can import them
from a single location::

    from API.ai_gateway.models import Swin2SRModel, SDx4UpscalerModel, WhisperModel
"""

from ..base_model import BaseAIModel, ModelInfo
from .swin2sr_model import Swin2SRModel
from .sd_x4_upscaler_model import SDx4UpscalerModel
from .whisper_model import WhisperModel

__all__ = [
    "BaseAIModel",
    "ModelInfo",
    "Swin2SRModel",
    "SDx4UpscalerModel",
    "WhisperModel",
]
