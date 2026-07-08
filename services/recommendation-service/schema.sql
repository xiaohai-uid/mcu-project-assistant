CREATE TABLE IF NOT EXISTS component_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL REFERENCES component_categories(id),
    price REAL NOT NULL,
    voltage REAL,
    pin_count INTEGER,
    protocol TEXT,
    compatible_platforms TEXT NOT NULL DEFAULT 'arduino',
    description TEXT,
    specifications TEXT
);

INSERT OR IGNORE INTO component_categories VALUES
('board', '主控板', 'Microcontroller boards'),
('sensor', '传感器', 'Environmental and physical sensors'),
('actuator', '执行器', 'Motors, relays, solenoids'),
('display', '显示模块', 'LCD, OLED, LED displays'),
('communication', '通信模块', 'Bluetooth, WiFi, RF modules'),
('power', '电源模块', 'Power supplies, batteries, regulators');
