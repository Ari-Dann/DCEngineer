import { api } from "./api";

export type FanOption = { id: string; label: string };
export type VendorEntry = { name: string; models: string[] };
export type CatalogField = { id: string; label: string };
export type Catalog = {
  device_types: string[];
  fan_orientations: FanOption[];
  vendors: VendorEntry[];
  functions: string[];
  rack_height_presets: number[];
  other_label: string;
  fields?: CatalogField[];
};

const FALLBACK: Catalog = {
  device_types: ["server", "switch", "router", "firewall", "storage", "pdu", "ups", "other"],
  fan_orientations: [
    { id: "front-intake", label: "Front intake (correct cold aisle)" },
    { id: "rear-intake", label: "Rear intake" },
    { id: "incorrect-hot-aisle", label: "Incorrect — hot aisle" },
    { id: "incorrect-cold-aisle", label: "Incorrect — cold aisle" },
    { id: "unknown", label: "Unknown / not visible" },
  ],
  vendors: [{ name: "Other", models: ["Other"] }],
  functions: [],
  rack_height_presets: [42, 45, 47, 48, 52, 58],
  other_label: "Other",
};

let cached: Catalog | null = null;

export function invalidateCatalog() {
  cached = null;
}

export async function loadCatalog(force = false): Promise<Catalog> {
  if (cached && !force) return cached;
  try {
    cached = await api<Catalog>("/api/catalog");
    return cached;
  } catch {
    return cached || FALLBACK;
  }
}

export async function learnCatalog(body: {
  vendor?: string;
  model?: string;
  device_type?: string;
  function?: string;
}): Promise<Catalog> {
  const payload = Object.fromEntries(
    Object.entries(body).filter(([, v]) => v && v.trim() && v.trim().toLowerCase() !== "other"),
  );
  if (!Object.keys(payload).length) return loadCatalog();
  try {
    cached = await api<Catalog>("/api/catalog/learn", { method: "POST", body: JSON.stringify(payload) });
    return cached;
  } catch {
    return loadCatalog();
  }
}

export const OTHER = "Other";
