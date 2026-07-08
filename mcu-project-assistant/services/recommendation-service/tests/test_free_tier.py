"""
TDD tests for free-tier recommendation bug fix.
Bug: Free users without model_config are rejected with empty recommendations.
Fix: Free users should always get built-in DB results.
"""
import json
import os
import sqlite3
from unittest.mock import MagicMock, patch

import pytest

RECOMMENDATION_OUTPUT = "recommendation.output"


@pytest.fixture
def mock_db(tmp_path):
    """Create an in-memory SQLite DB with test components."""
    db_path = str(tmp_path / "components.db")
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE components (
            id INTEGER PRIMARY KEY,
            name TEXT,
            category TEXT,
            price REAL,
            voltage REAL,
            pin_count INTEGER,
            protocol TEXT,
            compatible_platforms TEXT,
            description TEXT,
            specifications TEXT
        )
    """)
    conn.execute("""
        INSERT INTO components VALUES
        (1, 'Temperature Sensor', 'sensor', 5.0, 3.3, 4, 'I2C', 'arduino,esp32', 'DS18B20', '{}'),
        (2, 'LED', 'actuator', 1.0, 3.3, 2, ?, 'arduino,esp32,stm32', '5mm LED', '{}'),
        (3, 'Arduino Uno', 'board', 15.0, 5.0, 14, 'digital', 'arduino', 'ATmega328P', '{}')
    """, (None,))
    conn.commit()
    conn.close()
    return db_path


class TestFreeTierRecommendations:
    """Free users without model_config should get DB results, not errors."""

    def test_free_user_without_config_gets_db_results(self, mock_db):
        """Free users should get built-in DB recommendations, not an error."""
        message = {
            "designDraftId": "draft-1",
            "requirement": {"functionality": ["temperature"]},
            "membership": "free",
            "hasSearchKey": False,
            "modelConfig": None,
            "platform": "arduino",
        }

        ch = MagicMock()
        method = MagicMock()
        method.delivery_tag = 1

        published = []

        def capture_publish(queue, data):
            published.append((queue, data))

        with patch.dict(os.environ, {"MOCK_MODE": "0", "COMPONENTS_DB": mock_db}):
            import main

            # Patch main.client.publish directly
            with patch.object(main.client, "publish", side_effect=capture_publish):
                main.recommend_components(ch, method, None, json.dumps(message))

        # Should NOT have an error
        errors = [d for q_name, d in published if q_name == RECOMMENDATION_OUTPUT and d.get("error")]
        assert len(errors) == 0, f"Free user got error: {errors}"

        # Should have DB-based results with tiers
        results = [d for q_name, d in published if q_name == RECOMMENDATION_OUTPUT and "componentList" in d]
        assert len(results) >= 1
        component_list = results[-1]["componentList"]
        assert "tiers" in component_list
        tiers = component_list["tiers"]
        assert tiers["budget"] or tiers["standard"] or tiers["premium"]

    def test_free_user_with_config_also_gets_db(self, mock_db):
        """Free users with model_config should get DB results (+ AI fallback)."""
        message = {
            "designDraftId": "draft-1",
            "requirement": {"functionality": ["temperature"]},
            "membership": "free",
            "hasSearchKey": False,
            "modelConfig": {"apiKey": "sk-test", "endpoint": "http://localhost", "model": "gpt-3.5"},
            "platform": "arduino",
        }

        ch = MagicMock()
        method = MagicMock()
        method.delivery_tag = 1

        published = []

        def capture_publish(queue, data):
            published.append((queue, data))

        with patch.dict(os.environ, {"MOCK_MODE": "0", "COMPONENTS_DB": mock_db}):
            import importlib
            import main
            importlib.reload(main)

            with patch.object(main.client, "publish", side_effect=capture_publish):
                with patch("main.ai_match_components", return_value=[]):
                    main.recommend_components(ch, method, None, json.dumps(message))

        results = [d for q_name, d in published if q_name == RECOMMENDATION_OUTPUT and "componentList" in d]
        assert len(results) >= 1
        component_list = results[-1]["componentList"]
        assert "tiers" in component_list