import { AisleRow, Device, Rack } from "./api";

export type PowerUnit = "W" | "kW";

export function wattsFromDisplay(value: number, unit: PowerUnit): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return unit === "kW" ? Math.round(value * 1000) : Math.round(value);
}

export function displayFromWatts(watts: number, unit: PowerUnit): number {
  if (unit === "kW") return Math.round((watts / 1000) * 1000) / 1000;
  return watts;
}

export function formatPowerWatts(watts: number | null | undefined): string {
  if (watts == null || !Number.isFinite(watts) || watts < 0) return "—";
  if (watts === 0) return "0 W";
  if (watts >= 1000) {
    const kw = watts / 1000;
    const text = Number.isInteger(kw) ? String(kw) : kw.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `${text} kW`;
  }
  return `${Math.round(watts)} W`;
}

export function rackIdsForRow(rowId: number, racks: Rack[]): number[] {
  return racks.filter((r) => r.row_id === rowId).map((r) => r.id);
}

export function rackIdsForArea(areaId: number, racks: Rack[], rows: AisleRow[]): number[] {
  const rowIds = new Set(rows.filter((r) => r.area_id === areaId).map((r) => r.id));
  return racks
    .filter((r) => r.area_id === areaId || (r.row_id != null && rowIds.has(r.row_id)))
    .map((r) => r.id);
}

export function sumPowerWatts(devices: Device[], rackIds?: Iterable<number>): number {
  const allow = rackIds == null ? null : rackIds instanceof Set ? rackIds : new Set(rackIds);
  let total = 0;
  for (const device of devices) {
    if (allow && (device.rack_id == null || !allow.has(device.rack_id))) continue;
    total += device.power_draw_watts || 0;
  }
  return total;
}
