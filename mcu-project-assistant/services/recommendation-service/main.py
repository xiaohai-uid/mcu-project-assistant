import os
import json
import sqlite3
import traceback
from pydantic import BaseModel
from shared.llm_client import LLMClient, LLMError
from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client

client = make_rabbitmq_client()

DB_PATH = os.getenv("COMPONENTS_DB", "components.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def check_compatibility(component: dict, platform: str) -> dict:
    platforms = component.get("compatible_platforms", "").lower()
    compatible = platform.lower() in platforms
    reasons = []
    if not compatible:
        reasons.append(f"Component '{component['name']}' not compatible with {platform}")
    return {"compatible": compatible, "reasons": reasons}


def allocate_tiers(components: list[dict], platform: str) -> dict:
    tiers = {"budget": [], "standard": [], "premium": []}
    for c in components:
        compat = check_compatibility(c, platform)
        if not compat["compatible"]:
            continue
        price = c["price"]
        if price < 3:
            tiers["budget"].append(c)
        elif price < 15:
            tiers["standard"].append(c)
        else:
            tiers["premium"].append(c)
    return tiers


def detect_conflicts(components: list[dict]) -> list[dict]:
    conflicts = []
    for i, a in enumerate(components):
        for b in components[i + 1:]:
            va = a.get("voltage")
            vb = b.get("voltage")
            if va and vb and abs(va - vb) > 1.0:
                conflicts.append({
                    "type": "voltage_mismatch",
                    "severity": "warning",
                    "message": f"{a['name']} ({va}V) and {b['name']} ({vb}V) voltage mismatch",
                })
    return conflicts


class ComponentSuggestion(BaseModel):
    name: str
    category: str
    price: float
    reason: str

class ComponentSuggestions(BaseModel):
    components: list[ComponentSuggestion]


def ai_match_components(requirement: dict, model_config: dict) -> list[dict]:
    llm = LLMClient(
        api_key=model_config.get("apiKey"),
        base_url=model_config.get("endpoint"),
        model=model_config.get("model"),
    )
    try:
        result = llm.chat(
            system_prompt="You are an embedded systems component selection expert. Suggest suitable components for the given project requirement.",
            user_prompt=f"Requirement: {json.dumps(requirement, ensure_ascii=False)}",
            response_model=ComponentSuggestions,
        )
        items = []
        for comp in result.components:
            items.append({
                "name": comp.name,
                "category": comp.category,
                "price": comp.price,
                "reason": comp.reason,
                "isAiSuggested": True,
                "compatible_platforms": "arduino",
            })
        return items
    except LLMError:
        return []


def recommend_components(ch, method, _properties, body):
    try:
        message = json.loads(body)
        requirement = message.get("requirement", {})
        membership = message.get("membership", "free")
        has_search_key = message.get("hasSearchKey", False)
        model_config = message.get("modelConfig")
        platform = message.get("platform", "arduino")
        design_draft_id = message["designDraftId"]

        from shared.llm_client import MOCK_MODE
        # Free users without model_config get built-in DB results (no AI fallback)
        use_ai_fallback = model_config is not None

        conn = get_db()
        categories = []
        for func in requirement.get("functionality", []):
            cat = _map_functionality_to_category(func)
            if cat:
                categories.append(cat)

        if not categories:
            categories = ["sensor", "actuator", "board"]

        placeholders = ",".join("?" for _ in categories)
        cursor = conn.execute(
            f"SELECT * FROM components WHERE category IN ({placeholders})",
            categories,
        )
        db_components = [dict(row) for row in cursor.fetchall()]
        conn.close()

        if not db_components and model_config:
            ai_results = ai_match_components(requirement, model_config)
            for r in ai_results:
                db_components.append({
                    "id": -1,
                    "name": r["name"],
                    "category": r.get("category", "sensor"),
                    "price": r.get("price", 10.0),
                    "voltage": None,
                    "pin_count": None,
                    "protocol": None,
                    "compatible_platforms": r.get("compatible_platforms", "arduino"),
                    "description": r.get("reason", ""),
                    "specifications": "{}",
                    "isAiSuggested": True,
                })

        compatible = [c for c in db_components if check_compatibility(c, platform)["compatible"]]

        tiers = allocate_tiers(compatible, platform)

        all_selected = []
        for tlist in tiers.values():
            all_selected.extend(tlist)
        conflicts = detect_conflicts(all_selected) if len(all_selected) > 1 else []

        use_websearch = membership in ("subscription", "pay-as-you-go") or has_search_key

        result = {
            "tiers": tiers,
            "useWebSearch": use_websearch,
            "conflicts": conflicts,
            "source": "ai" if any(c.get("isAiSuggested") for c in all_selected) else "database",
            "totalCosts": {
                tier: round(sum(c["price"] for c in comps), 2)
                for tier, comps in tiers.items()
            },
        }

        if use_websearch and compatible:
            client.publish(q.WEBSERACH_INPUT, {
                "designDraftId": design_draft_id,
                "components": [c["name"] for c in compatible[:10]],
            })

        client.publish(q.RECOMMENDATION_OUTPUT, {
            "designDraftId": design_draft_id,
            "componentList": result,
        })
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception:
        traceback.print_exc()
        try:
            client.publish(q.RECOMMENDATION_OUTPUT, {
                "designDraftId": message.get("designDraftId"),
                "error": "Recommendation processing failed",
            })
        except Exception:
            pass
        ch.basic_ack(delivery_tag=method.delivery_tag)


def _map_functionality_to_category(func: str) -> str:
    mapping = {
        "temperature": "sensor", "humidity": "sensor",
        "light": "sensor", "sound": "sensor",
        "motion": "sensor", "distance": "sensor",
        "motor": "actuator", "led": "actuator",
        "display": "display", "lcd": "display", "oled": "display",
        "bluetooth": "communication", "wifi": "communication",
        "rfid": "communication", "keypad": "communication",
    }
    return mapping.get(func.lower().strip())


def main():
    run_service(
        name="recommendation",
        port=8002,
        declare_queues=[q.RECOMMENDATION_OUTPUT],
        bindings=[
            QueueBinding(queue=q.RECOMMENDATION_INPUT, callback=recommend_components),
        ],
        client=client,
        before_consume=_seed_db,
    )


def _seed_db():
    try:
        from seed import seed
        seed()
    except Exception as e:
        print(f"Seed warning: {e}")


if __name__ == "__main__":
    main()
