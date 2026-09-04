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

export function formatAmps(amps: number | null | undefined): string {
  if (amps == null || !Number.isFinite(amps) || amps < 0) return "—";
  if (amps === 0) return "0 A";
  const text = Number.isInteger(amps) ? String(amps) : amps.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text} A`;
}

export function formatHierarchyPower(watts: number | null | undefined, amps: number | null | undefined): string {
  const ac = formatPowerWatts(watts ?? 0) + " AC";
  if (amps && amps > 0) return `${ac} · ${formatAmps(amps)} DC`;
  return ac;
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

function allowedRackIds(rackIds?: Iterable<number>): Set<number> | null {
  if (rackIds == null) return null;
  return rackIds instanceof Set ? rackIds : new Set(rackIds);
}

export function countDevices(devices: Device[], rackIds?: Iterable<number>): number {
  const allow = allowedRackIds(rackIds);
  let total = 0;
  for (const device of devices) {
    if (allow && (device.rack_id == null || !allow.has(device.rack_id))) continue;
    total += 1;
  }
  return total;
}

export function sumPowerWatts(devices: Device[], rackIds?: Iterable<number>): number {
  const allow = allowedRackIds(rackIds);
  let total = 0;
  for (const device of devices) {
    if (allow && (device.rack_id == null || !allow.has(device.rack_id))) continue;
    total += device.power_draw_watts || 0;
  }
  return total;
}

export function sumDcAmps(devices: Device[], rackIds?: Iterable<number>): number {
  const allow = allowedRackIds(rackIds);
  let total = 0;
  for (const device of devices) {
    if (allow && (device.rack_id == null || !allow.has(device.rack_id))) continue;
    total += device.dc_power_draw_amps || 0;
  }
  return total;
}
