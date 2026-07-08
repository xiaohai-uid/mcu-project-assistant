## ADDED Requirements

### Requirement: System generates pin mapping diagram
The system SHALL generate a clear pin-to-pin wiring mapping between the microcontroller and each component.

#### Scenario: Pin mapping table generation
- **WHEN** user has finalized component selection
- **THEN** system generates a pin mapping table showing: microcontroller pin number, component name, component pin name, wire color suggestion
- **AND** table SHALL be formatted for easy printing

#### Scenario: Pin conflict detection
- **WHEN** system maps pins to components
- **THEN** it SHALL prevent assigning the same pin to multiple conflicting components
- **AND** it SHALL consider pin special functions (I2C: SDA/SCL, SPI: MOSI/MISO/SCK/SS, UART: TX/RX, PWM, ADC)

### Requirement: System generates wiring diagram
The system SHALL generate a visual wiring/schematic diagram showing how components connect.

#### Scenario: SVG wiring diagram generation
- **WHEN** system generates wiring information
- **THEN** it SHALL produce an SVG wiring diagram showing: microcontroller board outline, each component with labeled pins, connection lines between pins, power and ground connections
- **AND** diagram SHALL be visually clear and suitable for printing on A4 paper

#### Scenario: Power distribution visualization
- **WHEN** system generates wiring diagram
- **THEN** it SHALL show power distribution: which components need 5V vs 3.3V, ground connections, external power supply requirements
- **AND** SHALL highlight if voltage level shifting is needed between components
