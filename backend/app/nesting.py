"""Nest chassis/shelf components that share or sit inside a parent's U range."""

from __future__ import annotations

import re
from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.models import Device

_CONTAINER_RE = re.compile(r"\b(?:blade\s+chassis|chassis|shelf|enclosure)\b", re.IGNORECASE)
_UCS_5108_RE = re.compile(r"ucs[-\s]?sp[-\s]?5108|ucs[-\s]?5108|n20-c6508", re.IGNORECASE)


def ru_range(device: Device) -> tuple[int, int] | None:
    if device.ru_start is None:
        return None
    start = int(device.ru_start)
    end = int(device.ru_end or device.ru_start)
    return (min(start, end), max(start, end))


def occupies_elevation(device: Device) -> bool:
    """True when this device should own rack U slots (parents, not nested children)."""
    return device.ru_start is not None and not getattr(device, "parent_device_id", None)


def looks_like_container(device: Device) -> bool:
    blob = " ".join(
        str(getattr(device, key, "") or "")
        for key in ("name", "model", "device_type", "function")
    )
    return bool(_CONTAINER_RE.search(blob) or _UCS_5108_RE.search(blob))


def _strictly_contains(outer: tuple[int, int], inner: tuple[int, int]) -> bool:
    return outer[0] <= inner[0] and inner[1] <= outer[1] and outer != inner


def _span(r: tuple[int, int]) -> int:
    return r[1] - r[0] + 1


def find_parent(device: Device, others: Iterable[Device]) -> Device | None:
    """Smallest enclosing parent, or equal-span chassis/shelf for shared U ranges."""
    child_range = ru_range(device)
    if not child_range:
        return None
    child_is_container = looks_like_container(device)
    candidates: list[tuple[int, int, Device]] = []
    for other in others:
        if other is device or getattr(other, "id", None) == getattr(device, "id", None):
            continue
        if device.rack_id is None or other.rack_id != device.rack_id:
            continue
        parent_range = ru_range(other)
        if not parent_range:
            continue
        if _strictly_contains(parent_range, child_range):
            candidates.append((_span(parent_range), other.id or 0, other))
            continue
        if parent_range != child_range:
            continue
        # Same U range: nest under a container, never two containers into each other.
        if child_is_container or not looks_like_container(other):
            continue
        candidates.append((_span(parent_range), other.id or 0, other))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], item[1]))
    return candidates[0][2]


def nest_devices(devices: list[Device]) -> int:
    """Assign parent_device_id in place. Returns how many devices are nested."""
    by_rack: dict[int, list[Device]] = {}
    for device in devices:
        device.parent_device_id = None
        if device.rack_id is None:
            continue
        by_rack.setdefault(device.rack_id, []).append(device)
    nested = 0
    for group in by_rack.values():
        for device in group:
            parent = find_parent(device, group)
            if parent is None:
                continue
            device.parent_device_id = parent.id
            nested += 1
    return nested


def nest_devices_in_racks(db: Session, rack_ids: Iterable[int]) -> int:
    ids = sorted({rid for rid in rack_ids if rid})
    if not ids:
        return 0
    devices = db.query(Device).filter(Device.rack_id.in_(ids)).all()
    nested = nest_devices(devices)
    db.flush()
    return nested


def descendants(db: Session, device_id: int) -> list[Device]:
    kids = db.query(Device).filter(Device.parent_device_id == device_id).all()
    out = list(kids)
    for child in kids:
        out.extend(descendants(db, child.id))
    return out


def detach_children(db: Session, device_id: int) -> None:
    db.query(Device).filter(Device.parent_device_id == device_id).update(
        {Device.parent_device_id: None},
        synchronize_session=False,
    )


def nested_count_for(device: Device, devices: Iterable[Device]) -> int:
    return sum(1 for other in devices if getattr(other, "parent_device_id", None) == device.id)
