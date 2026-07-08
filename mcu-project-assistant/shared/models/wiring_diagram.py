from pydantic import BaseModel
from typing import List


class PinTableRow(BaseModel):
    microcontrollerPin: str
    componentName: str
    componentPin: str
    wireColor: str
    connectionType: str


class WiringDiagram(BaseModel):
    svgContent: str
    pinTable: List[PinTableRow]
    powerNotes: List[str]
