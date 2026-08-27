from app.catalog import identity_index, infer_identity, remember_identity


def test_infer_cisco_catalyst_switch_from_name():
    got = infer_identity("Cisco Catalyst 3560G Ethernet Switch")
    assert got["vendor"] == "Cisco"
    assert got["model"] == "Catalyst 3560G"
    assert got["device_type"] == "switch"


def test_infer_known_catalog_model_canonical_name():
    got = infer_identity("Cisco Catalyst 9300-48P Switch")
    assert got["vendor"] == "Cisco"
    assert got["model"] == "Catalyst 9300-48P"
    assert got["device_type"] == "switch"


def test_infer_vendor_alias_and_known_model():
    got = infer_identity("Aruba 2930F")
    assert got["vendor"] == "HPE Aruba"
    assert got["model"] == "Aruba 2930F"


def test_infer_leaves_unknown_names_blank():
    assert infer_identity("Floor Widget 12") == {}
    assert infer_identity("Random Box") == {}


def test_infer_type_without_inventing_vendor_or_model():
    got = infer_identity("Mystery Ethernet Switch")
    assert got == {"device_type": "switch"}


def test_infer_cisco_without_model_when_no_product_leftover():
    got = infer_identity("Cisco Switch")
    assert got["vendor"] == "Cisco"
    assert got["device_type"] == "switch"
    assert "model" not in got


def test_user_defined_vendor_is_used_when_indexed():
    index = identity_index()
    remember_identity(index, vendor="AcmeGear", model="Widget 9", device_type="tap")
    got = infer_identity("AcmeGear Widget 9 Network Tap", index=index)
    assert got["vendor"] == "AcmeGear"
    assert got["model"] == "Widget 9"
    assert got["device_type"] == "tap"
