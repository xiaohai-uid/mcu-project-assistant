"""conftest.py — mock shared module imports to avoid pika/httpx dependencies."""
import sys
from unittest.mock import MagicMock


class QueueNames:
    """Simple namespace for queue names (replaces shared.rabbitmq.queues)."""
    REQUIREMENT_INPUT = "requirement.input"
    REQUIREMENT_OUTPUT = "requirement.output"
    RECOMMENDATION_INPUT = "recommendation.input"
    RECOMMENDATION_OUTPUT = "recommendation.output"
    WEBSERACH_INPUT = "websearch.input"
    WEBSERACH_OUTPUT = "websearch.output"
    CODEGEN_INPUT = "codegen.input"
    CODEGEN_OUTPUT = "codegen.output"
    SCHEMATIC_INPUT = "schematic.input"
    SCHEMATIC_OUTPUT = "schematic.output"


# Mock shared modules before they're imported by main.py
mock_shared = MagicMock()
mock_shared_llm = MagicMock()
mock_shared_rabbitmq = MagicMock()

# Set queues as an attribute on the rabbitmq module
mock_shared_rabbitmq.queues = QueueNames()

sys.modules["shared"] = mock_shared
sys.modules["shared.llm_client"] = mock_shared_llm
sys.modules["shared.rabbitmq"] = mock_shared_rabbitmq
sys.modules["shared.rabbitmq.client"] = mock_shared_rabbitmq
sys.modules["shared.rabbitmq.queues"] = mock_shared_rabbitmq.queues

# Mock client instance that main.py references
mock_client = MagicMock()
mock_shared_rabbitmq.client = mock_client

# Mock bootstrap
mock_bootstrap = MagicMock()
sys.modules["shared.bootstrap"] = mock_bootstrap
mock_bootstrap.run_service = MagicMock()
mock_bootstrap.QueueBinding = MagicMock
mock_bootstrap.make_rabbitmq_client = MagicMock(return_value=mock_client)

# Mock LLMClient
mock_shared_llm.LLMClient = MagicMock()
mock_shared_llm.LLMError = Exception
mock_shared_llm.MOCK_MODE = False