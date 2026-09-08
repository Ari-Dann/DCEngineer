/** Ignore results from an older in-flight load when a newer one has started. */

export type LoadGeneration = {
  id: number;
  isCurrent: () => boolean;
};

export function nextLoad(current: { id: number }): LoadGeneration {
  const id = current.id + 1;
  current.id = id;
  return {
    id,
    isCurrent: () => current.id === id,
  };
}

export function suggestedDeviceName(name: string, ruStart?: number | "") {
  const trimmed = (name || "").trim();
  if (trimmed) return trimmed;
  if (ruStart) return `U${ruStart}`;
  return "New device";
}

export function captureDraftHasWork(draft: {
  name: string;
  serial: string;
  hostname: string;
  asset_tag: string;
  notes: string;
  model: string;
}, photoCount = 0) {
  if (photoCount > 0) return true;
  return Boolean(
    draft.name.trim() ||
      draft.serial.trim() ||
      draft.hostname.trim() ||
      draft.asset_tag.trim() ||
      draft.notes.trim() ||
      draft.model.trim(),
  );
}
