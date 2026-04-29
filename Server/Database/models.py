import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    agent_key = relationship("AgentKey", back_populates="owner", uselist=False)

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email}>"


class AgentKey(Base):
    """One per user. Holds the API key used to authenticate agent requests."""

    __tablename__ = "agent_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    api_key = Column(String(128), nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    owner = relationship("User", back_populates="agent_key")

    def __repr__(self) -> str:
        return f"<AgentKey id={self.id} user_id={self.user_id}>"
