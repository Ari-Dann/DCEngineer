from app.importer import (
    apply_location,
    apply_netbox_location,
    known_field,
    looks_like_netbox,
    parse_location,
    suggest_mapping,
)


def test_parse_location_a12_r09_ru19():
    got = parse_location("A12 R09-RU19")
    assert got == {"row": "A12", "rack": "09", "ru_start": "19"}


def test_parse_location_accepts_common_separators_and_words():
    expected = {"row": "A12", "rack": "09", "ru_start": "19"}
    assert parse_location("A12-R09-RU19") == expected
    assert parse_location("A12/R09/U19") == expected
    assert parse_location("A12 R09 RU19") == expected
    assert parse_location("Row A12 Rack 09 RU 19") == expected
    assert parse_location("hall 3 A12 R09-RU19") == expected


def test_parse_location_ru_range():
    got = parse_location("A12 R09-RU19-RU21")
    assert got == {"row": "A12", "rack": "09", "ru_start": "19", "ru_end": "21"}
    assert parse_location("A12 R09-RU19-21")["ru_end"] == "21"


def test_parse_location_rack_and_ru_without_row():
    assert parse_location("R09-RU19") == {"rack": "09", "ru_start": "19"}


def test_parse_location_row_and_rack_without_ru():
    assert parse_location("A12 R09") == {"row": "A12", "rack": "09"}


def test_parse_location_rejects_noise():
    assert parse_location("") == {}
    assert parse_location("closet") == {}
    assert parse_location("Cisco ASR 1001-X") == {}


def test_apply_location_fills_blank_layout_fields_only():
    filled = apply_location({"location": "A12 R09-RU19", "name": "sw-1"})
    assert filled["row"] == "A12"
    assert filled["rack"] == "09"
    assert filled["ru_start"] == "19"
    kept = apply_location({"location": "A12 R09-RU19", "row": "B07", "rack": "CAB-1", "ru_start": "4"})
    assert kept["row"] == "B07"
    assert kept["rack"] == "CAB-1"
    assert kept["ru_start"] == "4"


def test_location_and_owner_headers_are_recognized():
    assert known_field("Location") == "location"
    assert known_field("Physical Location") == "location"
    assert known_field("Owner") == "owner"
    assert known_field("Client") == "owner"


def test_generic_role_header_maps_to_function_not_type():
    assert known_field("role") == "function"
    mapping = suggest_mapping(["name", "role", "rack"])
    assert mapping["function"] == 1
    assert "device_type" not in mapping
    assert not looks_like_netbox(["name", "role", "rack"])


def test_netbox_headers_remap_role_manufacturer_device_type_location():
    headers = [
        "name",
        "role",
        "tenant",
        "manufacturer",
        "device_type",
        "serial",
        "asset_tag",
        "status",
        "site",
        "location",
        "rack",
        "position",
        "face",
        "comments",
    ]
    assert looks_like_netbox(headers)
    mapping = suggest_mapping(headers)
    assert mapping["device_type"] == headers.index("role")
    assert mapping["vendor"] == headers.index("manufacturer")
    assert mapping["model"] == headers.index("device_type")
    assert mapping["area"] == headers.index("location")
    assert mapping["ru_start"] == headers.index("position")
    assert mapping["owner"] == headers.index("tenant")
    assert mapping["notes"] == headers.index("comments")
    assert "function" not in mapping
    assert "location" not in mapping


def test_apply_netbox_location_splits_nested_area_row():
    nested = apply_netbox_location({"location": "Hall A / Row 1", "name": "sw-1"})
    assert nested["area"] == "Hall A"
    assert nested["row"] == "Row 1"
    from_area = apply_netbox_location({"area": "Hall A / Row 1", "name": "sw-1"})
    assert from_area["area"] == "Hall A"
    assert from_area["row"] == "Row 1"
    room = apply_netbox_location({"location": "Cage 7", "name": "sw-1"})
    assert room["area"] == "Cage 7"
    assert not room.get("row")

