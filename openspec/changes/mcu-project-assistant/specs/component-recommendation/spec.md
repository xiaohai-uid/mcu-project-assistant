## ADDED Requirements

### Requirement: System maintains a built-in component database
The system SHALL maintain a database of common microcontroller components with specifications, compatibility, pricing, and availability.

#### Scenario: Component database contains essential categories
- **WHEN** system loads the component database
- **THEN** it SHALL contain entries for: microcontroller boards (Arduino Uno/Nano/Mega, ESP32/8266, STM32 Blue Pill/Black Pill), sensors (temperature, humidity, motion, distance, light, gas), actuators (servo, stepper, DC motor, relay), display modules (LCD, OLED, LED matrix), communication modules (Bluetooth, WiFi, LoRa, NFC, RF), power modules, passive components
- **AND** each entry SHALL include: name, category, specifications, compatible platforms, typical price range, pinout reference

#### Scenario: Component compatibility is verified
- **WHEN** system recommends components for a project
- **THEN** it SHALL check voltage level compatibility between components
- **AND** it SHALL verify pin requirements (digital/analog/PWM/I2C/SPI/UART) don't exceed available pins on the selected microcontroller
- **AND** it SHALL flag any known incompatibilities

### Requirement: System uses AI for intelligent component selection
The system SHALL use AI knowledge to supplement the built-in database and make intelligent component recommendations.

#### Scenario: AI recommends components for described functionality
- **WHEN** system has analyzed the project requirements
- **THEN** AI identifies the components needed to implement each function
- **AND** AI considers alternative components with different price/performance trade-offs

#### Scenario: AI handles novel or uncommon component queries
- **WHEN** user requests functionality that requires components not in the built-in database
- **THEN** AI SHALL use its knowledge to suggest appropriate components
- **AND** system SHALL mark these as "AI-suggested" with a confidence level

### Requirement: System generates multi-tier component lists
The system SHALL generate three tiers of component lists based on cost and quality.

#### Scenario: Budget tier generation
- **WHEN** user selects budget tier
- **THEN** system recommends the most cost-effective compatible components
- **AND** prioritizes commonly available, well-documented parts
- **AND** total cost target is minimized

#### Scenario: Standard tier generation
- **WHEN** user selects standard tier
- **THEN** system recommends balanced components with good price/performance ratio
- **AND** includes moderate quality-of-life features (e.g., better modules, more stable voltage regulators)

#### Scenario: Premium tier generation
- **WHEN** user selects premium tier
- **THEN** system recommends high-performance or branded components
- **AND** includes additional features like industrial-grade parts, built-in protection circuits

### Requirement: System shows component sourcing information
The system SHALL provide sourcing guidance for recommended components.

#### Scenario: Component sourcing display
- **WHEN** system displays component recommendations
- **THEN** it SHALL show estimated price, typical sellers, and link references for each component
- **AND** it SHALL note component availability (common/rare/special order)
