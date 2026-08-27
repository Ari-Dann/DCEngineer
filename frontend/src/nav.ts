export function projectHref(
  pid: number,
  opts?: { tab?: string; area?: number | "" | null; row?: number | "" | null },
) {
  const qs = new URLSearchParams();
  if (opts?.tab && opts.tab !== "overview") qs.set("tab", opts.tab);
  if (opts?.area) qs.set("area", String(opts.area));
  if (opts?.row) qs.set("row", String(opts.row));
  const query = qs.toString();
  return `/projects/${pid}${query ? `?${query}` : ""}`;
}

export function rackHref(
  pid: number,
  rackId: number,
  opts?: { area?: number | "" | null; row?: number | "" | null },
) {
  const qs = new URLSearchParams();
  if (opts?.area) qs.set("area", String(opts.area));
  if (opts?.row) qs.set("row", String(opts.row));
  const query = qs.toString();
  return `/projects/${pid}/racks/${rackId}${query ? `?${query}` : ""}`;
}

export function parseIdParam(value: string | null): number | "" {
  if (!value) return "";
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : "";
}
