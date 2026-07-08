from enum import Enum
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class Membership(str, Enum):
    FREE = "free"
    HAS_KEY = "hasKey"
    SUBSCRIPTION = "subscription"
    PAYG = "pay-as-you-go"


class AiModel(str, Enum):
    FREE_API = "free_api"
    USER_KEY = "user_key"
    PREMIUM_API = "premium_api"


class ExperienceLevel(str, Enum):
    BEGINNER = "beginner"
    PROFESSIONAL = "professional"


class Platform(str, Enum):
    ARDUINO = "arduino"
    ESP32 = "esp32"
    STM32 = "stm32"


class DesignDraftStatus(str, Enum):
    ANALYZING = "analyzing"
    RECOMMENDING = "recommending"
    GENERATING = "generating"
    READY = "ready"
    STALE = "stale"
    FAILED = "failed"


class Tier(str, Enum):
    BUDGET = "budget"
    STANDARD = "standard"
    PREMIUM = "premium"


class ModelConfig(BaseModel):
    level: AiModel
    endpoint: str
    apiKey: Optional[str] = None
    model: str


class RequestContext(BaseModel):
    designDraftId: str
    userId: str
    membership: Membership
    experienceLevel: ExperienceLevel
    modelConfig: ModelConfig
