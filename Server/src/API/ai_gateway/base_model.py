"""
Base interface for all AI models exposed through the gateway.

Every concrete model class **must** inherit from ``BaseAIModel`` and
implement the three lifecycle hooks:

    wake_up()   — download / load weights into memory (GPU or CPU)
    process()   — run inference on a single request
    unload()    — release GPU memory and any cached state

The base class also provides:
    • ``is_loaded`` property
    • ``model_info`` property → dict with name, status, device
    • Thread-safety via an ``asyncio.Lock`` on wake/unload
"""

from __future__ import annotations

import abc
import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ModelInfo:
    """Read-only snapshot of a model's current state."""

    name: str
    model_id: str
    task: str
    is_loaded: bool = False
    device: str = "cpu"
    extra: dict[str, Any] = field(default_factory=dict)


class BaseAIModel(abc.ABC):
    """Abstract base class every AI model adapter must implement."""

    def __init__(self, name: str, model_id: str, task: str) -> None:
        self._name = name
        self._model_id = model_id
        self._task = task
        self._is_loaded = False
        self._device = "cpu"
        self._lock = asyncio.Lock()

    # ── Public properties ─────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return self._name

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def task(self) -> str:
        return self._task

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    @property
    def device(self) -> str:
        return self._device

    @property
    def model_info(self) -> ModelInfo:
        return ModelInfo(
            name=self._name,
            model_id=self._model_id,
            task=self._task,
            is_loaded=self._is_loaded,
            device=self._device,
        )

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def ensure_loaded(self) -> None:
        """Thread-safe lazy loader — calls ``wake_up`` only once."""
        if self._is_loaded:
            return
        async with self._lock:
            if self._is_loaded:          # double-check after acquiring lock
                return
            logger.info("Waking up model %s (%s) …", self._name, self._model_id)
            await self.wake_up()
            self._is_loaded = True
            logger.info("Model %s is ready on %s", self._name, self._device)

    async def safe_unload(self) -> None:
        """Thread-safe unloader."""
        async with self._lock:
            if not self._is_loaded:
                return
            logger.info("Unloading model %s …", self._name)
            await self.unload()
            self._is_loaded = False
            logger.info("Model %s unloaded", self._name)

    # ── Abstract hooks ────────────────────────────────────────────────────

    @abc.abstractmethod
    async def wake_up(self) -> None:
        """Load the model weights into memory / GPU.

        Implementations should set ``self._device`` appropriately.
        """

    @abc.abstractmethod
    async def process(self, **kwargs: Any) -> Any:
        """Run a single inference request.

        Subclasses define their own keyword arguments and return types.
        """

    @abc.abstractmethod
    async def unload(self) -> None:
        """Release all resources (GPU memory, caches, temp files)."""
