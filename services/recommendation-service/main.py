import os
import json
import sqlite3
import traceback
from urllib.parse import quote
from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client
from shared.domain.compatibility import check_compatibility, detect_conflicts
from shared.domain.pins import COMPONENT_LIBRARIES, COMPONENT_INTERFACE
from shared.logging_config import get_logger

client = make_rabbitmq_client()
logger = get_logger("recommendation")

DB_PATH = os.getenv("COMPONENTS_DB", "components.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def make_purchase_url(component_name: str) -> dict:
    """Generate purchase search URLs for a component."""
    encoded = quote(component_name)
    return {
        "lcsc": f"https://so.szlcsc.com/global.html?k={encoded}",
        "taobao": f"https://s.taobao.com/search?q={encoded}+arduino",
        "aliexpress": f"https://www.aliexpress.com/w/wholesale-{encoded}.html",
    }


def resolve_library_deps(component_name: str) -> list[str]:
    """Resolve Arduino library dependencies for a component."""
    if component_name in COMPONENT_LIBRARIES:
        return COMPONENT_LIBRARIES[component_name]
    for key, libs in COMPONENT_LIBRARIES.items():
        if key in component_name or component_name in key:
            return libs
    return []


def match_component_in_db(exact_name: str, conn) -> dict | None:
    """Find a component in the database by exact or fuzzy name match."""
    # Exact match first
    cursor = conn.execute("SELECT * FROM components WHERE name = ?", (exact_name,))
    row = cursor.fetchone()
    if row:
        return dict(row)

    # Fuzzy: check if DB name contains the query or vice versa
    cursor = conn.execute("SELECT * FROM components")
    for row in cursor.fetchall():
        db_name = row["name"]
        if exact_name in db_name or db_name in exact_name:
            return dict(row)

    return None


def recommend_components(ch, method, _properties, body):
    try:
        message = json.loads(body)
        requirement = message.get("requirement", {})
        membership = message.get("membership", "free")
        model_config = message.get("modelConfig")
        platform = message.get("platform", "arduino")
        design_draft_id = message["designDraftId"]

        exact_components = requirement.get("exactComponents", [])

        if not exact_components:
            # Fallback: use functionality list to guess components
            exact_components = _fallback_components(requirement)

        conn = get_db()
        selected = []
        not_found = []

        for ec in exact_components:
            name = ec.get("name", "") if isinstance(ec, dict) else str(ec)
            role = ec.get("role", "") if isinstance(ec, dict) else ""
            interface = ec.get("interface", "digital") if isinstance(ec, dict) else "digital"

            db_comp = match_component_in_db(name, conn)

            if db_comp:
                # Enrich with library deps and purchase URLs
                db_comp["role"] = role or db_comp.get("description", "")
                db_comp["interface"] = interface
                db_comp["libraryDependencies"] = resolve_library_deps(db_comp["name"])
                db_comp["purchaseUrls"] = make_purchase_url(db_comp["name"])
                selected.append(db_comp)
            else:
                # Component not in DB — create entry from requirement info
                fallback = {
                    "name": name,
                    "category": _guess_category(interface, role),
                    "price": 5.0,  # default estimate
                    "voltage": 5.0,
                    "pin_count": 3,
                    "protocol": interface,
                    "compatible_platforms": "arduino",
                    "description": role,
                    "role": role,
                    "interface": interface,
                    "libraryDependencies": resolve_library_deps(name),
                    "purchaseUrls": make_purchase_url(name),
                    "isAiSuggested": True,
                }
                selected.append(fallback)
                not_found.append(name)

        conn.close()

        # Always ensure a board is included
        has_board = any(c.get("category") == "board" for c in selected)
        if not has_board:
            selected.insert(0, {
                "name": "Arduino Uno R3",
                "category": "board",
                "price": 18.00,
                "voltage": 5.0,
                "pin_count": 14,
                "protocol": None,
                "compatible_platforms": "arduino",
                "description": "ATmega328P, 14 digital I/O, 6 analog",
                "role": "主控制器",
                "interface": "board",
                "libraryDependencies": [],
                "purchaseUrls": make_purchase_url("Arduino Uno R3"),
            })

        # Always add breadboard + jumper wires as accessories
        accessories = [
            {"name": "面包板", "category": "accessory", "price": 2.00, "role": "电路搭建",
             "interface": "none", "libraryDependencies": [], "purchaseUrls": make_purchase_url("面包板 830孔")},
            {"name": "杜邦线套装", "category": "accessory", "price": 1.50, "role": "连接线",
             "interface": "none", "libraryDependencies": [], "purchaseUrls": make_purchase_url("杜邦线 公对母")},
        ]
        selected.extend(accessories)

        # Compatibility & conflict checks
        conflicts = detect_conflicts([c for c in selected if c.get("voltage")])

        # Pin count validation for Arduino UNO
        pin_warnings = _check_pin_budget(selected)

        total_cost = round(sum(c.get("price", 0) for c in selected), 2)

        result = {
            "components": selected,
            "conflicts": conflicts,
            "pinWarnings": pin_warnings,
            "totalCost": total_cost,
            "totalCostCNY": round(total_cost * 7.2, 2),  # rough USD->CNY
            "notFoundInDb": not_found,
            "source": "database+ai" if not_found else "database",
            "platform": platform,
        }

        # Publish websearch for price verification (if tier allows)
        use_websearch = membership in ("subscription", "pay-as-you-go")
        if use_websearch:
            client.publish(q.WEBSEARCH_INPUT, {
                "designDraftId": design_draft_id,
                "components": [c["name"] for c in selected if c.get("category") != "accessory"],
            })

        client.publish(q.RECOMMENDATION_OUTPUT, {
            "designDraftId": design_draft_id,
            "componentList": result,
        })
        logger.info(f"Draft {design_draft_id}: {len(selected)} components, "
                    f"${total_cost:.2f} total, {len(conflicts)} conflicts",
                    extra={"design_draft_id": design_draft_id, "stage": "recommendation"})
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception:
        traceback.print_exc()
        try:
            client.publish(q.RECOMMENDATION_OUTPUT, {
                "designDraftId": message.get("designDraftId"),
                "error": "Recommendation processing failed: " + traceback.format_exc(),
            })
        except Exception:
            pass
        ch.basic_ack(delivery_tag=method.delivery_tag)


def _fallback_components(requirement: dict) -> list[dict]:
    """When exactComponents is missing, build a basic list from functionality."""
    from shared.domain.classification import map_functionality_to_category
    components = []
    func_to_default = {
        "temperature": {"name": "DHT22", "role": "温度采集", "interface": "digital"},
        "humidity": {"name": "DHT22", "role": "湿度采集", "interface": "digital"},
        "moisture": {"name": "土壤湿度传感器", "role": "土壤湿度检测", "interface": "analog"},
        "light": {"name": "光敏电阻模块", "role": "光照检测", "interface": "analog"},
        "distance": {"name": "HC-SR04", "role": "距离测量", "interface": "digital"},
        "display": {"name": "LCD1602", "role": "数据显示", "interface": "i2c"},
        "motor": {"name": "L298N 电机驱动", "role": "电机控制", "interface": "pwm"},
        "servo": {"name": "SG90 舵机", "role": "角度控制", "interface": "pwm"},
        "pump": {"name": "小型水泵", "role": "浇水执行", "interface": "digital"},
        "relay": {"name": "继电器模块", "role": "开关控制", "interface": "digital"},
        "buzzer": {"name": "蜂鸣器", "role": "声音报警", "interface": "pwm"},
        "led": {"name": "LED 灯带", "role": "灯光指示", "interface": "digital"},
        "sound": {"name": "声音传感器", "role": "声音检测", "interface": "analog"},
        "gas": {"name": "MQ-135", "role": "气体检测", "interface": "analog"},
        "pressure": {"name": "BMP280", "role": "气压检测", "interface": "i2c"},
    }
    seen = set()
    for func in requirement.get("functionality", []):
        default = func_to_default.get(func.lower())
        if default and default["name"] not in seen:
            components.append(default)
            seen.add(default["name"])
    if not components:
        components.append({"name": "DHT22", "role": "温湿度采集", "interface": "digital"})
    return components


def _guess_category(interface: str, role: str) -> str:
    """Guess component category from interface and role."""
    if interface == "analog":
        return "sensor"
    if interface in ("pwm", "digital") and any(w in role for w in ["控制", "驱动", "执行", "泵", "电机"]):
        return "actuator"
    if "显示" in role or "display" in role.lower():
        return "display"
    return "sensor"


def _check_pin_budget(components: list[dict]) -> list[str]:
    """Check if total pin usage exceeds Arduino UNO limits."""
    warnings = []
    analog_used = 0
    digital_used = 0
    i2c_count = 0

    for comp in components:
        if comp.get("category") in ("board", "accessory", "power"):
            continue
        iface = comp.get("interface", "digital")
        info = COMPONENT_INTERFACE.get(comp.get("name", ""), {})
        pins_needed = info.get("pins_needed", 1)

        if iface == "analog":
            analog_used += pins_needed
        elif iface == "i2c":
            i2c_count += 1
        elif iface in ("digital", "pwm", "uart", "spi"):
            digital_used += pins_needed

    if analog_used > 6:
        warnings.append(f"模拟引脚不足：需要 {analog_used} 个，Arduino UNO 只有 6 个 (A0-A5)")
    if digital_used > 12:
        warnings.append(f"数字引脚不足：需要 {digital_used} 个，Arduino UNO 只有 12 个 (D2-D13)")
    if i2c_count > 0 and analog_used > 4:
        warnings.append("I2C 设备使用 A4/A5，与模拟输入 A4/A5 冲突")

    return warnings


def _seed_db():
    try:
        from seed import seed
        seed()
    except Exception as e:
        print(f"[recommendation] Seed warning: {e}")


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


if __name__ == "__main__":
    main()
