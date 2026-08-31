import type { AisleRow, Area, Project, Rack } from "./api";

export const RESTRICTION_TYPES = ["government", "EMSS", "other"] as const;
export type RestrictionType = "" | (typeof RESTRICTION_TYPES)[number];

export type Restrictable = {
  restricted?: boolean;
  restriction_type?: string;
  restricted_reason?: string;
  photography_allowed?: boolean;
};

export type RestrictionHit = { label: string; type: string };

export function restrictionFields(type: RestrictionType) {
  return {
    restricted: Boolean(type),
    restriction_type: type,
    photography_allowed: !type,
  };
}

export function deviceRestrictionFields(type: RestrictionType) {
  return {
    restricted: Boolean(type),
    restricted_reason: type,
  };
}

export function restrictionTypeOf(entity?: Restrictable | null): RestrictionType {
  if (!entity) return "";
  const raw = (entity.restriction_type || entity.restricted_reason || "").trim();
  if (raw === "government" || raw === "EMSS" || raw === "other") return raw;
  if (entity.restricted || entity.photography_allowed === false) return raw === "" ? "other" : "other";
  return "";
}

export function isRestrictedEntity(entity?: Restrictable | null): boolean {
  if (!entity) return false;
  return Boolean(entity.restricted) || entity.photography_allowed === false;
}

export function inheritedPhotoBlockers(opts: {
  project?: Project | null;
  area?: Area | null;
  row?: AisleRow | null;
  rack?: Rack | null;
}): RestrictionHit[] {
  const hits: RestrictionHit[] = [];
  const push = (entity: Restrictable | null | undefined, label: string) => {
    if (!entity || !isRestrictedEntity(entity)) return;
    hits.push({ label, type: restrictionTypeOf(entity) || "restricted" });
  };
  push(opts.project, "project");
  if (opts.area) push(opts.area, `area ${opts.area.name}`);
  if (opts.row) push(opts.row, `row ${opts.row.name}`);
  if (opts.rack) push(opts.rack, `rack ${opts.rack.name}`);
  return hits;
}

export function photosAllowed(opts: {
  project?: Project | null;
  area?: Area | null;
  row?: AisleRow | null;
  rack?: Rack | null;
  device?: Restrictable | null;
}): boolean {
  if (opts.device && isRestrictedEntity(opts.device)) return false;
  return inheritedPhotoBlockers(opts).length === 0;
}

export function restrictionCaption(entity?: Restrictable | null, inherited: RestrictionHit[] = []): string {
  const type = restrictionTypeOf(entity);
  if (type) return `${type} · no photos`;
  if (entity?.restricted) return "restricted · no photos";
  if (entity?.photography_allowed === false) return "photos forbidden";
  if (inherited.length) {
    const first = inherited[0];
    return `via ${first.label} (${first.type}) · no photos`;
  }
  return "photos OK";
}
