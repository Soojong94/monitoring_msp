from pydantic import BaseModel
from typing import Optional, List


# Auth
class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


# Server
class ServerAliasUpdate(BaseModel):
    display_customer: Optional[str] = None
    display_server: Optional[str] = None
    notes: Optional[str] = None


class ServerInfo(BaseModel):
    customer_id: str
    server_name: str
    display_customer: Optional[str] = None
    display_server: Optional[str] = None
    notes: Optional[str] = None
    online: bool = False
    last_seen: Optional[str] = None
    inactive: bool = False


# Alerts
class EmailEntry(BaseModel):
    id: Optional[int] = None
    email: str
    enabled: bool = True


class ThresholdConfig(BaseModel):
    cpu: int = 90
    memory: int = 90
    disk: int = 90


class AlertConfigUpdate(BaseModel):
    emails: Optional[List[EmailEntry]] = None
    thresholds: Optional[ThresholdConfig] = None


class AlertConfigResponse(BaseModel):
    customer_id: str
    emails: List[EmailEntry] = []
    thresholds: ThresholdConfig = ThresholdConfig()


class AddEmailRequest(BaseModel):
    email: str


# Users
class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "viewer"


class UserUpdate(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    created_at: Optional[str] = None
    last_login: Optional[str] = None


# Agent command
class AgentCommandRequest(BaseModel):
    customer_id: str
    server_name: str
    csp: str = "onprem"
    region: str = "kr"
    environment: str = "prod"
    mode: str = "direct"
    relay_url: Optional[str] = None


class AgentCommandResponse(BaseModel):
    linux: str
    windows: str
