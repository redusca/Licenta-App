from __future__ import annotations

import abc
import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ModelInfo:
    name: str
    model_id: str
    task: str
    is_loaded: bool = False
    device: str = "cpu"
    extra: dict[str, Any] = field(default_factory=dict)


class BaseAIModel(abc.ABC):
    def __init__(self, name: str, model_id: str, task: str) -> None:
        self._name = name
        self._model_id = model_id
        self._task = task
        self._is_loaded = False
        self._device = "cpu"
        self._lock = asyncio.Lock()

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

    async def ensure_loaded(self) -> None:
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
        async with self._lock:
            if not self._is_loaded:
                return
            logger.info("Unloading model %s …", self._name)
            await self.unload()
            self._is_loaded = False
            logger.info("Model %s unloaded", self._name)

    @abc.abstractmethod
    async def wake_up(self) -> None: ...

    @abc.abstractmethod
    async def process(self, **kwargs: Any) -> Any: ...

    @abc.abstractmethod
    async def unload(self) -> None: ...
