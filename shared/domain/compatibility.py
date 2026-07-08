def check_compatibility(component: dict, platform: str) -> dict:
    platforms = component.get("compatible_platforms", "").lower()
    compatible = platform.lower() in platforms
    reasons = []
    if not compatible:
        reasons.append(f"Component '{component['name']}' not compatible with {platform}")
    return {"compatible": compatible, "reasons": reasons}


def allocate_tiers(components: list[dict], platform: str | None = None) -> dict:
    tiers = {"budget": [], "standard": [], "premium": []}
    for c in components:
        if platform is not None:
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
