"""Well-known network/compute vendors and models for capture dropdowns."""

from __future__ import annotations

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

    def upsert(kind: str, value: str, parent: str = "") -> None:
        if not _is_custom(value):
            return
        parent = parent.strip()
        existing = (
            db.query(CatalogEntry)
            .filter(CatalogEntry.kind == kind)
            .all()
        )
        for row in existing:
            if row.value.lower() == value.lower() and row.parent.lower() == parent.lower():
                return
        db.add(CatalogEntry(kind=kind, value=value, parent=parent))
        db.flush()

    if _is_custom(vendor):
        upsert("vendor", vendor)
        if _is_custom(model):
            upsert("model", model, vendor)
    if _is_custom(device_type) and device_type.lower() not in {t.lower() for t in DEVICE_TYPES}:
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
        "vendors": ordered,
        "functions": functions,
        "rack_height_presets": RACK_HEIGHT_PRESETS,
        "other_label": "Other",
        "fields": IMPORT_FIELDS,
    }


# Shared with the importer so mapping UI and capture dropdowns stay aligned.
IMPORT_FIELDS = [
    {"id": "name", "label": "Device name"},
    {"id": "hostname", "label": "Hostname"},
    {"id": "vendor", "label": "Vendor / manufacturer"},
    {"id": "model", "label": "Model"},
    {"id": "serial", "label": "Serial"},
    {"id": "asset_tag", "label": "Asset tag"},
    {"id": "rack", "label": "Rack"},
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
]
