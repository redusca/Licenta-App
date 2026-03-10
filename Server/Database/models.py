import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, Boolean, DateTime, ForeignKey, Enum as SAEnum, Text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class ContainerMode(str, enum.Enum):
    server_hosted = "server_hosted"
    self_hosted = "self_hosted"


class ContainerStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    stopped = "stopped"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    container = relationship("Container", back_populates="owner", uselist=False)

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email}>"


class Container(Base):
    __tablename__ = "containers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    mode = Column(SAEnum(ContainerMode), nullable=False, default=ContainerMode.server_hosted)
    # For server_hosted: http://host:port  — set automatically after docker deploy
    # For self_hosted: URL provided by user
    internal_url = Column(String(512), nullable=True)
    docker_container_id = Column(String(128), nullable=True)
    status = Column(SAEnum(ContainerStatus), nullable=False, default=ContainerStatus.pending)
    # Per-container secret the owner uses to authenticate with the container API
    api_key = Column(String(128), nullable=False, default=lambda: str(uuid.uuid4()))
    google_api_key = Column(Text, nullable=True)  # encrypted at rest in production
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    owner = relationship("User", back_populates="container")

    def __repr__(self) -> str:
        return f"<Container id={self.id} user_id={self.user_id} status={self.status}>"
