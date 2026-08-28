from app.importer import apply_location, known_field, parse_location


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
