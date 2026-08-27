## ADDED Requirements

### Requirement: User can describe project idea
The system SHALL provide a web interface where users can describe their microcontroller project idea in natural language.

#### Scenario: User submits a project description
- **WHEN** user enters a natural language description of their project idea (e.g., "I want to make a temperature-controlled fan with WiFi control")
- **THEN** system analyzes the description and extracts key requirements (functionality, inputs, outputs, connectivity, power needs)
- **AND** system displays the parsed requirements for user confirmation

#### Scenario: User provides incomplete description
- **WHEN** user submits a vague or incomplete description
- **THEN** system identifies missing information and asks targeted questions to clarify
- **AND** system uses multi-turn conversation to fill in the gaps

### Requirement: System supports multi-turn requirement refinement
The system SHALL support an interactive dialog to refine project requirements before generating recommendations.

#### Scenario: Interactive requirement gathering
- **WHEN** user has provided an initial description
- **THEN** system asks about target platform preference (or auto-recommends based on requirements)
- **AND** system asks about budget range and complexity level
- **AND** system asks about any specific components the user already owns

### Requirement: System provides cost tier selection
The system SHALL offer three cost tiers for each project: budget, standard, and premium.

#### Scenario: User selects a cost tier
- **WHEN** system presents project analysis result
- **THEN** user can choose between budget/standard/premium tier
- **AND** each tier shows estimated total cost and component count
