from sqlalchemy import Column, Integer, Text, UniqueConstraint
from database import Base
from datetime import datetime, timezone


def _now():
    return datetime.now(timezone.utc).isoformat()


class ServerAlias(Base):
    __tablename__ = "server_aliases"

    customer_id = Column(Text, primary_key=True)
    server_name = Column(Text, primary_key=True)
    display_customer = Column(Text)
    display_server = Column(Text)
    notes = Column(Text)
    created_at = Column(Text, default=_now)
    updated_at = Column(Text, default=_now)


class CustomerEmail(Base):
    __tablename__ = "customer_emails"

    id = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(Text, nullable=False)
    email = Column(Text, nullable=False)
    enabled = Column(Integer, default=1)
    created_at = Column(Text, default=_now)

    __table_args__ = (UniqueConstraint("customer_id", "email"),)


class AlertThreshold(Base):
    __tablename__ = "alert_thresholds"

    customer_id = Column(Text, primary_key=True)
    cpu = Column(Integer, default=90)
    memory = Column(Integer, default=90)
    disk = Column(Integer, default=90)
    retention_days = Column(Integer, default=1095)  # 3년 기본
    updated_at = Column(Text, default=_now)


class InactiveServer(Base):
    __tablename__ = "inactive_servers"

    customer_id = Column(Text, primary_key=True)
    server_name = Column(Text, primary_key=True)
    deactivated_at = Column(Text, default=_now)
    reason = Column(Text)


class PortalUser(Base):
    __tablename__ = "portal_users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(Text, unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    role = Column(Text, default="admin")
    created_at = Column(Text, default=_now)
    last_login = Column(Text)


class AlertHistory(Base):
    __tablename__ = "alert_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fingerprint = Column(Text, index=True)
    customer_id = Column(Text)
    server_name = Column(Text)
    alert_name = Column(Text)
    status = Column(Text)
    severity = Column(Text)
    message = Column(Text)
    started_at = Column(Text)
    resolved_at = Column(Text)
    received_at = Column(Text, default=_now)
