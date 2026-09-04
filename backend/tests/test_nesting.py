from types import SimpleNamespace

from app.nesting import elevation_occupants, find_parent, looks_like_container, nest_devices, occupies_elevation


def _dev(**kwargs):
    data = dict(
        id=0,
        rack_id=1,
        name="",
        model="",
        device_type="",
        function="",
        ru_start=None,
        ru_end=None,
        parent_device_id=None,
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


def test_looks_like_container_chassis_shelf_and_ucs_pids():
    assert looks_like_container(_dev(name="Cisco UCS-SP-5108-AC", model="UCS-SP-5108-AC"))
    assert looks_like_container(_dev(model="UCS 5108"))
    assert looks_like_container(_dev(model="N20-C6508"))
    assert looks_like_container(_dev(name="Disk shelf 1", device_type="storage"))
    assert looks_like_container(_dev(function="blade chassis"))
    assert looks_like_container(_dev(device_type="nas"))
    assert looks_like_container(_dev(device_type="chassis"))
    assert looks_like_container(_dev(name="Synology NAS"))
    assert looks_like_container(_dev(name="enclosure A"))
    assert not looks_like_container(_dev(name="blade-a", serial="SN-1"))
    assert not looks_like_container(_dev(name="core-sw", model="C9300-48P"))


def test_nest_containment_under_smallest_enclosing_chassis():
    chassis = _dev(id=1, name="Cisco UCS-SP-5108-AC", model="UCS-SP-5108-AC", ru_start=32, ru_end=38)
    blade_a = _dev(id=2, name="blade-a", ru_start=34, ru_end=34)
    blade_b = _dev(id=3, name="blade-b", ru_start=34, ru_end=34)
    standalone = _dev(id=4, name="core-sw", ru_start=20, ru_end=21)
    nested = nest_devices([chassis, blade_a, blade_b, standalone])
    assert nested == 2
    assert blade_a.parent_device_id == chassis.id
    assert blade_b.parent_device_id == chassis.id
    assert chassis.parent_device_id is None
    assert standalone.parent_device_id is None
    assert occupies_elevation(chassis)
    assert not occupies_elevation(blade_a)
    assert occupies_elevation(standalone)


def test_same_range_components_nest_under_shelf():
    shelf = _dev(id=1, name="Disk shelf DS4246", model="DS4246", ru_start=10, ru_end=12)
    disk_a = _dev(id=2, name="disk-1", ru_start=10, ru_end=12)
    disk_b = _dev(id=3, name="disk-2", ru_start=10, ru_end=12)
    nest_devices([disk_a, disk_b, shelf])
    assert disk_a.parent_device_id == shelf.id
    assert disk_b.parent_device_id == shelf.id
    assert shelf.parent_device_id is None
    assert occupies_elevation(shelf)
    assert not occupies_elevation(disk_a)


def test_same_range_components_nest_under_chassis():
    chassis = _dev(id=1, name="UCS chassis", model="UCS-SP-5108", ru_start=32, ru_end=38)
    io_mod = _dev(id=2, name="IO module A", serial="SN-IO", ru_start=32, ru_end=38)
    nest_devices([io_mod, chassis])
    assert io_mod.parent_device_id == chassis.id
    assert chassis.parent_device_id is None


def test_two_equal_span_containers_do_not_nest():
    left = _dev(id=1, name="Chassis A", ru_start=1, ru_end=6)
    right = _dev(id=2, name="Chassis B", ru_start=1, ru_end=6)
    nest_devices([left, right])
    assert left.parent_device_id is None
    assert right.parent_device_id is None


def test_partial_overlap_does_not_nest():
    a = _dev(id=1, name="Chassis A", ru_start=32, ru_end=36)
    b = _dev(id=2, name="switch", ru_start=35, ru_end=40)
    nest_devices([a, b])
    assert a.parent_device_id is None
    assert b.parent_device_id is None


def test_find_parent_prefers_smallest_enclosing():
    chassis = _dev(id=1, name="blade chassis", ru_start=32, ru_end=38)
    shelf = _dev(id=2, name="midplane shelf", ru_start=34, ru_end=35)
    blade = _dev(id=3, name="blade-a", ru_start=34, ru_end=34)
    assert find_parent(blade, [chassis, shelf, blade]) is shelf
    assert find_parent(shelf, [chassis, shelf, blade]) is chassis


def test_same_range_components_nest_under_nas_type():
    nas = _dev(id=1, name="NetApp FAS", device_type="nas", ru_start=10, ru_end=12)
    disk_a = _dev(id=2, name="disk-1", ru_start=10, ru_end=12)
    disk_b = _dev(id=3, name="disk-2", ru_start=10, ru_end=12)
    nest_devices([disk_a, disk_b, nas])
    assert disk_a.parent_device_id == nas.id
    assert disk_b.parent_device_id == nas.id
    assert nas.parent_device_id is None
    assert occupies_elevation(nas)
    assert not occupies_elevation(disk_a)


def test_elevation_occupants_prefers_largest_on_overlap():
    large = _dev(id=2, name="chassis", device_type="chassis", ru_start=10, ru_end=20)
    small = _dev(id=1, name="switch", device_type="switch", ru_start=18, ru_end=24)
    occupied = elevation_occupants([small, large])
    assert occupied[10].id == large.id
    assert occupied[18].id == large.id
    assert occupied[20].id == large.id
    assert occupied[21].id == small.id
    assert occupied[24].id == small.id
    nested = nest_devices([small, large])
    assert nested == 0
    assert occupies_elevation(large)
    assert occupies_elevation(small)
