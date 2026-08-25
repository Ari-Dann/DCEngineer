import { api } from "./api";

export type FanOption = { id: string; label: string };
export type VendorEntry = { name: string; models: string[] };
export type Catalog = {
  device_types: string[];
  fan_orientations: FanOption[];
  vendors: VendorEntry[];
  rack_height_presets: number[];
  other_label: string;
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
  rack_height_presets: [42, 45, 47, 48, 52, 58],
  other_label: "Other",
};

let cached: Catalog | null = null;

export async function loadCatalog(): Promise<Catalog> {
  if (cached) return cached;
  try {
    cached = await api<Catalog>("/api/catalog");
    return cached;
  } catch {
    return FALLBACK;
  }
}

export const OTHER = "Other";
