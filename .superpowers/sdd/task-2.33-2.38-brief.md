# Tasks 2.33–2.38 — SchematicService

## Acceptance Criteria

### 2.33 — SVG Wiring Diagram
- `generate_svg(pinTable, components, platform)`: produce structured SVG wiring diagram
- Breadboard view with component rectangles, labeled pins, colored wires

### 2.34 — Component Layout
- `layout_components(components, pinTable)`: position components in rows, group by category
- Returns `{ x, y, width, height }` for each component

### 2.35 — Pin Mapping Visualization
- `render_pin_table(pinTable)`: generates SVG table section showing pin assignments
- Columns: Component → Pin → Wire → Connection Type

### 2.36 — Color-Coded Wires
- WIRE_COLORS dict: power=Red, ground=Black, signal=Yellow, data=Blue, pwm=Green
- Each wire uses standard color

### 2.37 — Annotation & BOM
- `generate_bom(components)`: bill of materials table as SVG
- Columns: Qty, Name, Category, Price, Notes

### 2.38 — Message Loop
- Manual ack, try/except, error publish

## Files
- **Modify:** `services/schematic-service/main.py` — full rewrite
- Working directory: `C:\Users\Administrator\Desktop\opencode\mcu-project-assistant`

## Wire Colors
```python
WIRE_COLORS = {
    "power": "#FF0000",    # Red
    "ground": "#000000",   # Black
    "signal": "#FFD700",   # Yellow
    "data": "#0000FF",     # Blue
    "i2c": "#FF69B4",      # Pink
    "spi": "#A52A2A",      # Brown
    "pwm": "#00AA00",      # Green
}
```

## SVG Layout Design

Generate an SVG with these sections:

1. **Header** (top): title, platform, timestamp
2. **Breadboard** (middle): component blocks arranged by category with pins labeled
3. **Pin Table** (bottom-left): compact table of all pin assignments
4. **BOM** (bottom-right): bill of materials
5. **Notes** (very bottom): power requirements, warnings

### Component block rendering
```
┌──────────────────────┐
│   DHT11              │
│   Pin 2 (VCC) ────   │  Red
│   Pin 4 (SIG) ────   │  Yellow  
│   Pin 1 (GND) ────   │  Black
└──────────────────────┘
```

Use `<rect>` with rounded corners, `<text>` for labels, `<line>` for wires.

## Validate
```powershell
cd C:\Users\Administrator\Desktop\opencode\mcu-project-assistant
python -c "import ast; ast.parse(open('services/schematic-service/main.py', encoding='utf-8').read()); print('OK')"
```

Return files modified and syntax validation result.