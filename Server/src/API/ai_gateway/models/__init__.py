"""
AI models sub-package.

Re-exports every model adapter so the gateway router can import them
from a single location::

    from API.ai_gateway.models import Swin2SRModel, WhisperModel
"""

from ..base_model import BaseAIModel, ModelInfo
from .swin2sr_model import Swin2SRModel
from .whisper_model import WhisperModel

__all__ = [
    "BaseAIModel",
    "ModelInfo",
    "Swin2SRModel",
    "WhisperModel",
]
