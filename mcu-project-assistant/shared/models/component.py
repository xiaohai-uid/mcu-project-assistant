from pydantic import BaseModel
from typing import List, Optional


class Component(BaseModel):
    id: str
    name: str
    category: str
    specifications: dict
    compatiblePlatforms: List[str]
    priceRange: tuple[float, float]
    pinout: Optional[dict] = None
    isAiSuggested: bool = False
    confidenceLevel: Optional[float] = None


class ComponentList(BaseModel):
    tier: str
    components: List[Component]
    totalCost: float
    source: str
