import re
from types import SimpleNamespace

from app.rbi_export import rack_svg


def _rack(**kwargs):
    data = dict(name="R01", ru_height=42)
    data.update(kwargs)
    return SimpleNamespace(**data)


def _dev(**kwargs):
    data = dict(
        id=1,
        rack_id=1,
        name="device",
        vendor="",
        model="",
        device_type="other",
        ru_start=1,
        ru_end=1,
        parent_device_id=None,
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


def _fill_rects(svg: str, fill: str) -> list[tuple[float, float]]:
    pattern = re.compile(
        rf'<rect [^>]*y="([0-9.]+)" [^>]*height="([0-9.]+)" [^>]*fill="{re.escape(fill)}"',
    )
    return [(float(y), float(h)) for y, h in pattern.findall(svg)]


def test_rack_svg_chassis_covers_all_seven_rus_not_just_the_top_u():
    svg = rack_svg(
        _rack(),
        [
            _dev(
                id=1,
                name="UCS chassis",
                vendor="Cisco",
                model="UCS-SP-5108",
                device_type="chassis",
                ru_start=32,
                ru_end=38,
            )
        ],
    )
    row_h = 18
    ru = 42
    y0 = 32 + (ru - 38) * row_h
    chassis = _fill_rects(svg, "#5b6fd6")
    assert chassis == [(y0 + 1, 7 * row_h - 3)]
    rails = svg.rfind('fill="#121820"')
    painted = svg.find('fill="#5b6fd6"')
    assert rails != -1 and painted != -1
    assert rails < painted
    assert "UCS chassis" in svg


def test_rack_svg_nested_blades_do_not_get_their_own_blocks():
    chassis = _dev(id=1, name="UCS chassis", device_type="chassis", ru_start=32, ru_end=38)
    blade = _dev(id=2, name="blade-a", ru_start=34, ru_end=34, parent_device_id=1)
    svg = rack_svg(_rack(), [chassis, blade])
    assert "UCS chassis" in svg
    assert "blade-a" not in svg
    assert len(_fill_rects(svg, "#5b6fd6")) == 1
