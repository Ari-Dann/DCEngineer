"""Well-known network/compute vendors and models for capture dropdowns."""

from __future__ import annotations

import re

DEVICE_TYPES = [
    "server",
    "switch",
    "router",
    "firewall",
    "storage",
    "pdu",
    "ups",
    "other",
]

FAN_ORIENTATIONS = [
    {"id": "front-intake", "label": "Front intake (correct cold aisle)"},
    {"id": "rear-intake", "label": "Rear intake"},
    {"id": "incorrect-hot-aisle", "label": "Incorrect — hot aisle"},
    {"id": "incorrect-cold-aisle", "label": "Incorrect — cold aisle"},
    {"id": "unknown", "label": "Unknown / not visible"},
]

INDICATOR_TYPES = [
    {"id": "none", "label": "None"},
    {"id": "led", "label": "LED"},
    {"id": "screen", "label": "Screen"},
    {"id": "both", "label": "LED + screen"},
    {"id": "unknown", "label": "Unknown"},
]

INDICATOR_COLORS = [
    {"id": "none", "label": "N/A"},
    {"id": "green", "label": "Green"},
    {"id": "amber", "label": "Amber"},
    {"id": "red", "label": "Red"},
    {"id": "blue", "label": "Blue"},
    {"id": "white", "label": "White"},
    {"id": "mixed", "label": "Mixed / RGB"},
    {"id": "off", "label": "Off / dark"},
    {"id": "unknown", "label": "Unknown"},
]

VENDORS: dict[str, list[str]] = {
    "Cisco": [
        "Catalyst 9200",
        "Catalyst 9300",
        "Catalyst 9300-48P",
        "Catalyst 9400",
        "Catalyst 9500",
        "Nexus 93180YC-EX",
        "Nexus 9336C-FX2",
        "Nexus 9504",
        "ISR 4331",
        "ISR 4451",
        "ASR 1001-X",
        "ASR 1002-HX",
        "ASA 5516-X",
        "Firepower 1120",
        "Firepower 2130",
        "UCS C220 M6",
        "UCS C240 M6",
        "UCS C240 M7",
        "CIMC",
        "Other",
    ],
    "Juniper": [
        "EX4300",
        "EX4400",
        "QFX5120",
        "QFX5130",
        "MX204",
        "MX480",
        "SRX345",
        "SRX1500",
        "PTX1000",
        "Other",
    ],
    "Arista": [
        "DCS-7050SX3-48YC8",
        "DCS-7060CX-32S",
        "DCS-7280R3",
        "DCS-7300X3",
        "DCS-7170",
        "Other",
    ],
    "MikroTik": [
        "CCR2004-1G-12S+2XS",
        "CCR2216-1G-12XS-2XQ",
        "CRS326-24G-2S+",
        "CRS317-1G-16S+",
        "RB4011iGS+",
        "RB5009UG+S+",
        "hEX S",
        "Other",
    ],
    "TRENDnet": [
        "TEG-S80g",
        "TEG-S16g",
        "TI-PG80",
        "TPE-TG80g",
        "TPE-TG160g",
        "Other",
    ],
    "Dell": [
        "PowerEdge R650",
        "PowerEdge R750",
        "PowerEdge R760",
        "PowerEdge R660",
        "PowerEdge MX740c",
        "PowerSwitch S5248F-ON",
        "PowerSwitch N3248TE-ON",
        "PowerVault ME5024",
        "Other",
    ],
    "HPE Aruba": [
        "Aruba 2930F",
        "Aruba 3810M",
        "Aruba 6300M",
        "Aruba 8360",
        "Aruba CX 8325",
        "ProLiant DL360 Gen10",
        "ProLiant DL380 Gen10",
        "ProLiant DL360 Gen11",
        "ProLiant DL380 Gen11",
        "Other",
    ],
    "Fortinet": [
        "FortiGate 60F",
        "FortiGate 100F",
        "FortiGate 200F",
        "FortiGate 600F",
        "FortiGate 1800F",
        "FortiSwitch 148F",
        "FortiSwitch 1024E",
        "FortiAnalyzer 800F",
        "Other",
    ],
    "Ubiquiti": [
        "UniFi Switch Pro 24",
        "UniFi Switch Pro 48 PoE",
        "UniFi Aggregation",
        "UniFi Dream Machine Pro",
        "UniFi Dream Machine SE",
        "EdgeRouter 4",
        "EdgeSwitch 24",
        "Other",
    ],
    "Netgear": [
        "M4250-26G4F-PoE+",
        "M4300-24X24F",
        "GS724T",
        "GS748T",
        "XS728T",
        "Other",
    ],
    "Palo Alto Networks": [
        "PA-440",
        "PA-850",
        "PA-1410",
        "PA-3220",
        "PA-3410",
        "PA-5220",
        "Other",
    ],
    "Supermicro": [
        "SuperServer 1029U",
        "SuperServer 2029P",
        "SuperServer SYS-221H-TNR",
        "Other",
    ],
    "Lenovo": [
        "ThinkSystem SR630",
        "ThinkSystem SR650",
        "ThinkSystem SR650 V3",
        "Other",
    ],
    "NVIDIA": [
        "SN3700",
        "SN4700",
        "SN5600",
        "Other",
    ],
    "APC": [
        "AP7921",
        "AP8941",
        "AP8881",
        "SRT5KRMXLT",
        "SMX3000RMLV2U",
        "Other",
    ],
    "Eaton": [
        "9PX 3000",
        "9PX 5000",
        "ePDU G3",
        "Other",
    ],
    "Raritan": [
        "PX3-5466V",
        "PX3-5880V",
        "Other",
    ],
    "F5": [
        "BIG-IP i2800",
        "BIG-IP rSeries r10900",
        "Other",
    ],
    "Check Point": [
        "6200",
        "16000",
        "28000",
        "Other",
    ],
    "Ciena": [
        "5164",
        "5171",
        "6500",
        "Other",
    ],
    "CommScope": [
        "SYSTIMAX 360",
        "imVision",
        "Other",
    ],
    "IBM": [
        "Power S1022",
        "FlashSystem 5200",
        "Other",
    ],
    "Oracle": [
        "X9-2",
        "ZFS Storage ZS9-2",
        "Other",
    ],
    "Other": ["Other"],
}

RACK_HEIGHT_PRESETS = [42, 45, 47, 48, 52, 58]

SKIP_VALUES = {"", "other", "n/a", "na", "none", "unknown", "-", "—"}

# Common letterheads that map onto a catalog vendor. Prefix-only; never guessed from mid-string.
VENDOR_ALIASES = {
    "cisco systems": "Cisco",
    "cisco systems inc": "Cisco",
    "cisco systems, inc": "Cisco",
    "juniper networks": "Juniper",
    "arista networks": "Arista",
    "dell emc": "Dell",
    "dell technologies": "Dell",
    "hewlett packard enterprise": "HPE Aruba",
    "hewlett-packard enterprise": "HPE Aruba",
    "hpe aruba": "HPE Aruba",
    "hpe": "HPE Aruba",
    "aruba": "HPE Aruba",
    "palo alto": "Palo Alto Networks",
    "palo alto networks": "Palo Alto Networks",
    "fortinet inc": "Fortinet",
    "ubiquiti networks": "Ubiquiti",
    "netgear inc": "Netgear",
    "supermicro computer": "Supermicro",
    "lenovo emc": "Lenovo",
    "nvidia networking": "NVIDIA",
    "mellanox": "NVIDIA",
    "american power conversion": "APC",
    "check point software": "Check Point",
    "checkpoint": "Check Point",
}

_TYPE_KEYWORDS = (
    ("ethernet switch", "switch"),
    ("gigabit switch", "switch"),
    ("switches", "switch"),
    ("switch", "switch"),
    ("routers", "router"),
    ("router", "router"),
    ("firewalls", "firewall"),
    ("firewall", "firewall"),
    ("storage array", "storage"),
    ("storage", "storage"),
    ("servers", "server"),
    ("server", "server"),
    ("pdus", "pdu"),
    ("pdu", "pdu"),
    ("uninterruptible power supply", "ups"),
    ("ups", "ups"),
)

_FILLER_WORDS = {
    "ethernet",
    "gigabit",
    "network",
    "networking",
    "managed",
    "unmanaged",
    "poe",
    "poe+",
    "plus",
    "layer",
    "l2",
    "l3",
    "series",
    "appliance",
    "device",
    "chassis",
    "modular",
    "stackable",
    "fibre",
    "fiber",
    "optic",
    "optical",
    "the",
    "and",
    "with",
    "for",
    "datacenter",
    "data",
    "center",
    "centre",
    "enterprise",
    "commercial",
    "industrial",
    "rackmount",
    "rack-mount",
}


def _clean(value: str | None) -> str:
    return (value or "").strip()


def _is_custom(value: str) -> bool:
    return bool(value) and value.strip().lower() not in SKIP_VALUES


def _add_vendor(vendors: dict[str, list[str]], name: str) -> str:
    for existing in vendors:
        if existing.lower() == name.lower():
            return existing
    vendors[name] = ["Other"]
    return name


def _add_model(vendors: dict[str, list[str]], vendor: str, model: str) -> None:
    key = _add_vendor(vendors, vendor)
    models = vendors[key]
    if any(m.lower() == model.lower() for m in models):
        return
    if models and models[-1].lower() == "other":
        models.insert(-1, model)
    else:
        models.append(model)


def _add_unique(items: list[str], value: str, *, keep_other_last: bool = True) -> None:
    if any(i.lower() == value.lower() for i in items):
        return
    if keep_other_last and items and items[-1].lower() == "other":
        items.insert(-1, value)
    else:
        items.append(value)


def learn_values(
    db,
    *,
    vendor: str = "",
    model: str = "",
    device_type: str = "",
    function: str = "",
) -> None:
    """Persist custom Other… values so they appear in future dropdowns."""
    from app.models import CatalogEntry

    vendor = _clean(vendor)
    model = _clean(model)
    device_type = _clean(device_type)
    function = _clean(function)

    def has_static_vendor(name: str) -> bool:
        return any(existing.lower() == name.lower() for existing in VENDORS)

    def has_static_model(parent: str, name: str) -> bool:
        for existing, models in VENDORS.items():
            if existing.lower() == parent.lower() and any(m.lower() == name.lower() for m in models):
                return True
        return False

    def upsert(kind: str, value: str, parent: str = "") -> None:
        if not _is_custom(value):
            return
        parent = parent.strip()
        if kind == "vendor" and has_static_vendor(value):
            return
        if kind == "model" and has_static_model(parent, value):
            return
        if kind == "device_type" and value.lower() in {t.lower() for t in DEVICE_TYPES}:
            return
        existing = db.query(CatalogEntry).filter(CatalogEntry.kind == kind).all()
        for row in existing:
            if row.value.lower() == value.lower() and row.parent.lower() == parent.lower():
                return
        db.add(CatalogEntry(kind=kind, value=value, parent=parent))
        db.flush()

    if _is_custom(vendor):
        upsert("vendor", vendor)
        if _is_custom(model):
            upsert("model", model, vendor)
    if _is_custom(device_type):
        upsert("device_type", device_type)
    if _is_custom(function):
        upsert("function", function)


def catalog_payload(db=None) -> dict:
    vendors: dict[str, list[str]] = {name: list(models) for name, models in VENDORS.items()}
    device_types = list(DEVICE_TYPES)
    functions: list[str] = []

    if db is not None:
        from app.models import CatalogEntry, Device

        for entry in db.query(CatalogEntry).order_by(CatalogEntry.value).all():
            if entry.kind == "vendor":
                _add_vendor(vendors, entry.value)
            elif entry.kind == "model" and entry.parent:
                _add_model(vendors, entry.parent, entry.value)
            elif entry.kind == "device_type":
                _add_unique(device_types, entry.value)
            elif entry.kind == "function":
                _add_unique(functions, entry.value, keep_other_last=False)

        for row in db.query(Device.vendor, Device.model, Device.device_type, Device.function).all():
            vendor = _clean(row.vendor)
            model = _clean(row.model)
            if _is_custom(vendor):
                _add_vendor(vendors, vendor)
                if _is_custom(model):
                    _add_model(vendors, vendor, model)
            dtype = _clean(row.device_type)
            if _is_custom(dtype):
                _add_unique(device_types, dtype)
            func = _clean(row.function)
            if _is_custom(func):
                _add_unique(functions, func, keep_other_last=False)

    other = vendors.pop("Other", ["Other"])
    ordered = [{"name": name, "models": models} for name, models in vendors.items()]
    ordered.append({"name": "Other", "models": other if other else ["Other"]})

    return {
        "device_types": device_types,
        "fan_orientations": FAN_ORIENTATIONS,
        "indicator_types": INDICATOR_TYPES,
        "indicator_colors": INDICATOR_COLORS,
        "vendors": ordered,
        "functions": functions,
        "rack_height_presets": RACK_HEIGHT_PRESETS,
        "other_label": "Other",
        "fields": IMPORT_FIELDS,
    }


def identity_index(db=None) -> dict:
    """Vendors, models, and types the importer may copy into blank identity fields."""
    payload = catalog_payload(db)
    vendors: list[tuple[str, list[str]]] = []
    prefixes: list[tuple[str, str]] = []
    families: set[str] = set()
    for entry in payload["vendors"]:
        name = _clean(entry.get("name"))
        if not name or name.lower() in SKIP_VALUES:
            continue
        models = [m for m in entry.get("models") or [] if _is_custom(m)]
        vendors.append((name, models))
        prefixes.append((name.lower(), name))
        for model in models:
            token = model.split()[0]
            if token and token.lower() not in SKIP_VALUES and not token.isdigit():
                families.add(token.lower())
    known_lower = {name.lower() for name, _ in vendors}
    for alias, canonical in VENDOR_ALIASES.items():
        target = next((name for name, _ in vendors if name.lower() == canonical.lower()), None)
        if target and alias.lower() not in known_lower:
            prefixes.append((alias.lower(), target))
    prefixes.sort(key=lambda item: len(item[0]), reverse=True)
    types = [t for t in payload["device_types"] if _is_custom(t)]
    return {"vendors": vendors, "prefixes": prefixes, "families": families, "types": types}


def _starts_with_prefix(text_lower: str, prefix: str) -> bool:
    if not prefix or not text_lower.startswith(prefix):
        return False
    if len(text_lower) == len(prefix):
        return True
    return not text_lower[len(prefix)].isalnum()


def _word_in(text_lower: str, phrase: str) -> bool:
    if not phrase:
        return False
    return re.search(rf"(?<![a-z0-9]){re.escape(phrase.lower())}(?![a-z0-9])", text_lower) is not None


def _infer_type(text_lower: str, custom_types: list[str] | None = None) -> str:
    for phrase, dtype in _TYPE_KEYWORDS:
        if _word_in(text_lower, phrase):
            return dtype
    extras = sorted((custom_types or []), key=len, reverse=True)
    skip = {t for _, t in _TYPE_KEYWORDS} | SKIP_VALUES
    for dtype in extras:
        if dtype.lower() in skip or (len(dtype) < 3 and dtype.lower() not in {"pdu", "ups"}):
            continue
        if _word_in(text_lower, dtype):
            return dtype
    return ""


def _longest_known_model(text: str, models: list[str]) -> str:
    lower = text.lower()
    best = ""
    for model in models:
        needle = model.lower()
        if not needle or needle in SKIP_VALUES:
            continue
        idx = lower.find(needle)
        if idx < 0:
            continue
        before_ok = idx == 0 or not lower[idx - 1].isalnum()
        after = idx + len(needle)
        after_ok = after == len(lower) or not lower[after].isalnum()
        if before_ok and after_ok and len(model) > len(best):
            best = model
    return best


def _strip_identity_noise(text: str, dtype: str) -> str:
    drop = {word.lower() for word in _FILLER_WORDS}
    if dtype:
        drop.add(dtype.lower())
        drop.update(phrase.lower() for phrase, mapped in _TYPE_KEYWORDS if mapped == dtype)
    tokens = [tok for tok in re.split(r"\s+", text.strip()) if tok]
    kept = []
    for token in tokens:
        bare = token.lower().strip(".,()/[]{}")
        if bare in drop:
            continue
        kept.append(token)
    return " ".join(kept).strip(" -,/")


def _acceptable_inferred_model(value: str, families: set[str]) -> bool:
    if not _is_custom(value):
        return False
    tokens = value.split()
    if not tokens:
        return False
    has_digit = any(any(ch.isdigit() for ch in token) for token in tokens)
    has_family = any(token.lower() in families for token in tokens)
    return has_digit or (has_family and len(tokens) >= 2)


def infer_identity(name: str, db=None, index: dict | None = None) -> dict[str, str]:
    """Fill vendor / model / type from a device name when those fields are blank.

    Conservative: vendor must be a known (or user-defined) prefix; type must be a
    standard keyword or a user-defined type word; model must match a known model
    or a leftover product string after a known vendor (family name and/or digits).
    """
    text = _clean(name)
    if not text:
        return {}
    lookup = index or identity_index(db)
    lower = text.lower()
    out: dict[str, str] = {}

    vendor = ""
    prefix_len = 0
    for prefix, canonical in lookup["prefixes"]:
        if _starts_with_prefix(lower, prefix):
            vendor = canonical
            prefix_len = len(prefix)
            break
    rest = text[prefix_len:].strip(" \t-–—,") if vendor else text
    if vendor:
        out["vendor"] = vendor

    dtype = _infer_type(lower, lookup.get("types") or [])
    if dtype:
        out["device_type"] = dtype

    models: list[str] = []
    if vendor:
        for existing, vendor_models in lookup["vendors"]:
            if existing.lower() == vendor.lower():
                models = vendor_models
                break
    known = _longest_known_model(text, models) if models else ""
    if known:
        out["model"] = known
    elif vendor:
        leftover = _strip_identity_noise(rest, dtype)
        if _acceptable_inferred_model(leftover, lookup.get("families") or set()):
            out["model"] = leftover[:128]
    return out


def remember_identity(index: dict, *, vendor: str = "", model: str = "", device_type: str = "") -> None:
    """Keep an in-memory identity index aligned with values learned during import."""
    vendor = _clean(vendor)
    model = _clean(model)
    device_type = _clean(device_type)
    if _is_custom(vendor):
        models: list[str] | None = None
        for name, vendor_models in index["vendors"]:
            if name.lower() == vendor.lower():
                models = vendor_models
                vendor = name
                break
        if models is None:
            models = []
            index["vendors"].append((vendor, models))
            index["prefixes"].append((vendor.lower(), vendor))
            index["prefixes"].sort(key=lambda item: len(item[0]), reverse=True)
        if _is_custom(model) and not any(existing.lower() == model.lower() for existing in models):
            models.append(model)
            token = model.split()[0]
            if token and token.lower() not in SKIP_VALUES and not token.isdigit():
                index["families"].add(token.lower())
    if _is_custom(device_type) and not any(existing.lower() == device_type.lower() for existing in index["types"]):
        index["types"].append(device_type)


# Shared with the importer so mapping UI and capture dropdowns stay aligned.
IMPORT_FIELDS = [
    {"id": "name", "label": "Device name"},
    {"id": "hostname", "label": "Hostname"},
    {"id": "vendor", "label": "Vendor / manufacturer"},
    {"id": "model", "label": "Model"},
    {"id": "serial", "label": "Serial"},
    {"id": "asset_tag", "label": "Asset tag"},
    {"id": "rack", "label": "Rack"},
    {"id": "row", "label": "Row / aisle"},
    {"id": "area", "label": "Area / hall"},
    {"id": "ru_start", "label": "RU start"},
    {"id": "ru_end", "label": "RU end"},
    {"id": "ru_height", "label": "Height (U)"},
    {"id": "device_type", "label": "Type"},
    {"id": "function", "label": "Function / role"},
    {"id": "management_ip", "label": "Management IP"},
    {"id": "notes", "label": "Notes"},
    {"id": "eol_date", "label": "EOL date"},
    {"id": "eos_date", "label": "EOS date"},
    {"id": "fan_orientation", "label": "Fan orientation"},
    {"id": "indicator_type", "label": "LED / screen"},
    {"id": "indicator_color", "label": "LED / screen color"},
]
