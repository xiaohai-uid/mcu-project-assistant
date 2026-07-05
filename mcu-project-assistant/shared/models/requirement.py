from pydantic import BaseModel
from typing import List, Optional


class IoRequirement(BaseModel):
    inputDevices: List[str]
    outputDevices: List[str]


class CommunicationRequirement(BaseModel):
    protocols: List[str]
    remoteControl: Optional[bool] = False


class Requirement(BaseModel):
    title: str
    description: str
    functionality: List[str]
    io: IoRequirement
    communication: CommunicationRequirement
    powerSupply: str
    targetPlatform: Optional[str] = None
    budgetRange: Optional[str] = None
