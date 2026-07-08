from pydantic import BaseModel
from typing import List, Optional


class PinMapping(BaseModel):
    microcontrollerPin: str
    componentName: str
    componentPin: str
    wireColor: Optional[str] = None


class GeneratedCode(BaseModel):
    platform: str
    mainFile: str
    fileName: str
    fileContent: str
    dependencies: List[str] = []
    pinMappings: List[PinMapping] = []
