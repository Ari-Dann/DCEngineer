import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Area,
  ImportField,
  ImportPreview,
  ImportPreviewSheet,
  ImportResult,
  Project,
  projects,
} from "../api";
import { invalidateCatalog } from "../catalog";

type HeaderMap = Record<number, string>;

const LOCATION_RE =
  /(?:row\s+)?([A-Za-z]{1,8}\d{1,4})\s*[/\-, ]+(?:r(?:ack)?\s*)?(\d{1,4})(?:\s*[/\-, ]+(?:r?u\s*)(\d{1,2})(?:\s*[-–]\s*(?:r?u\s*)?(\d{1,2}))?)?/i;
const LOCATION_RACK_RU_RE = /r(?:ack)?\s*(\d{1,4})\s*[/\-, ]+(?:r?u\s*)(\d{1,2})(?:\s*[-–]\s*(?:r?u\s*)?(\d{1,2}))?/i;
const RU_SPAN_RE = /^(?:r?u\s*)?(\d{1,2})(?:\s*[-–]\s*(?:r?u\s*)?(\d{1,2}))?$/i;
const DERIVED_LOCATION_FIELDS = ["row", "rack", "ru_start", "ru_end"] as const;

function parseRuSpan(value: string): { ru_start?: string; ru_end?: string } {
  const text = (value || "").trim();
  const match = text.match(RU_SPAN_RE);
  if (!match) return {};
  const out: { ru_start?: string; ru_end?: string } = { ru_start: match[1] };
  if (match[2]) out.ru_end = match[2];
  return out;
}

function normalizeRuFields(rec: Record<string, string>) {
  const start = parseRuSpan(rec.ru_start || "");
  if (start.ru_start) {
    rec.ru_start = start.ru_start;
    if (start.ru_end && !rec.ru_end) rec.ru_end = start.ru_end;
  }
  const end = parseRuSpan(rec.ru_end || "");
  if (end.ru_start) rec.ru_end = end.ru_end || end.ru_start;
  return rec;
}

function parseLocation(value: string): Record<string, string> {
  const text = (value || "").trim();
  if (!text) return {};
  const span = parseRuSpan(text);
  if (span.ru_start) return span;
  const full = text.match(LOCATION_RE);
  if (full) {
    const out: Record<string, string> = {};
    if (full[1]) out.row = full[1];
    if (full[2]) out.rack = full[2];
    if (full[3]) out.ru_start = full[3];
    if (full[4]) out.ru_end = full[4];
    return out;
  }
  const rackRu = text.match(LOCATION_RACK_RU_RE);
  if (!rackRu) return {};
  const out: Record<string, string> = {};
  if (rackRu[1]) out.rack = rackRu[1];
  if (rackRu[2]) out.ru_start = rackRu[2];
  if (rackRu[3]) out.ru_end = rackRu[3];
  return out;
}

function invertMapping(headerMap: HeaderMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [idx, field] of Object.entries(headerMap)) {
    if (field) out[field] = Number(idx);
  }
  return out;
}

function sampleRecords(sheet: ImportPreviewSheet, headerMap: HeaderMap) {
  return sheet.raw_sample.map((row) => {
    const rec: Record<string, string> = {};
    for (const [idx, field] of Object.entries(headerMap)) {
      if (field) rec[field] = row[Number(idx)] || "";
    }
    if (rec.location) {
      const parsed = parseLocation(rec.location);
      for (const key of DERIVED_LOCATION_FIELDS) {
        if (parsed[key] && !rec[key]) rec[key] = parsed[key];
      }
    }
    return normalizeRuFields(rec);
  });
}

function initialHeaderMap(sheet: ImportPreviewSheet): HeaderMap {
  const next: HeaderMap = {};
  for (const header of sheet.headers) {
    next[header.index] = header.suggested || "";
  }
  return next;
}

export default function ImportWizard({
  projectList,
  projectId,
  defaultAreaId: initialAreaId,
  onClose,
  onImported,
}: {
  projectList: Project[];
  projectId?: number;
  defaultAreaId?: number | "";
  onClose: () => void;
  onImported: (pid: number, result: ImportResult) => void;
}) {
  const [pid, setPid] = useState<number | "">(projectId ?? projectList[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [orientation, setOrientation] = useState<"rows" | "columns">("rows");
  const [headerIndex, setHeaderIndex] = useState(0);
  const [headerMap, setHeaderMap] = useState<HeaderMap>({});
  const [areas, setAreas] = useState<Area[]>([]);
  const [defaultAreaId, setDefaultAreaId] = useState<number | "">(initialAreaId || "");
  const [allSheets, setAllSheets] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pid) {
      setAreas([]);
      setDefaultAreaId("");
      return;
    }
    projects.areas(Number(pid)).then(setAreas).catch(() => setAreas([]));
    setDefaultAreaId(initialAreaId || "");
  }, [pid, initialAreaId]);

  const sheet = preview?.sheets.find((s) => s.name === sheetName) || preview?.sheets[0];
  const fields: ImportField[] = preview?.fields || [];
  const samples = useMemo(() => (sheet ? sampleRecords(sheet, headerMap) : []), [sheet, headerMap]);
  const mappedCount = Object.values(headerMap).filter(Boolean).length;
  const locationMapped = Object.values(headerMap).includes("location");
  const previewFields = useMemo(() => {
    const mapped = new Set(Object.values(headerMap).filter(Boolean));
    const shown = fields.filter((f) => mapped.has(f.id));
    if (!mapped.has("location")) return shown;
    const extra = fields.filter(
      (f) => DERIVED_LOCATION_FIELDS.includes(f.id as (typeof DERIVED_LOCATION_FIELDS)[number]) && !mapped.has(f.id),
    );
    const locAt = shown.findIndex((f) => f.id === "location");
    if (locAt < 0) return [...shown, ...extra];
    return [...shown.slice(0, locAt + 1), ...extra, ...shown.slice(locAt + 1)];
  }, [fields, headerMap]);

  async function loadPreview(
    nextFile: File,
    opts?: { sheet?: string; orientation?: "rows" | "columns"; header_index?: number },
  ) {
    setBusy(true);
    setError("");
    try {
      const body = await projects.previewImport(nextFile, opts);
      setPreview(body);
      const chosen = opts?.sheet || body.suggested_sheet || body.sheets[0]?.name || "";
      const chosenSheet = body.sheets.find((s) => s.name === chosen) || body.sheets[0];
      setSheetName(chosenSheet?.name || "");
      setOrientation(chosenSheet?.orientation || "rows");
      setHeaderIndex(chosenSheet?.header_index ?? 0);
      setHeaderMap(chosenSheet ? initialHeaderMap(chosenSheet) : {});
      if ((body.sheets || []).length <= 1) setAllSheets(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(next?: File) {
    if (!next) return;
    setFile(next);
    await loadPreview(next);
  }

  async function onSheetChange(name: string) {
    if (!file) return;
    setSheetName(name);
    await loadPreview(file, { sheet: name });
  }

  async function onOrientationChange(next: "rows" | "columns") {
    if (!file) return;
    setOrientation(next);
    await loadPreview(file, { sheet: sheetName, orientation: next });
  }

  async function onHeaderRowChange(next: number) {
    if (!file) return;
    setHeaderIndex(next);
    await loadPreview(file, { sheet: sheetName, orientation, header_index: next });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file || pid === "") {
      setError("Choose a project and a spreadsheet.");
      return;
    }
    const mapping = invertMapping(headerMap);
    if (
      !mapping.name &&
      !mapping.hostname &&
      !mapping.serial &&
      !mapping.area &&
      !mapping.row &&
      !mapping.rack &&
      !mapping.location
    ) {
      setError("Map a device field (name, hostname, or serial) or layout fields (area, row/aisle, rack, or location).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await projects.importFile(Number(pid), file, {
        sheet: sheetName,
        orientation,
        header_index: headerIndex,
        mapping,
        default_area_id: defaultAreaId || undefined,
        all_sheets: allSheets || undefined,
      });
      invalidateCatalog();
      onImported(Number(pid), result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <form className="sheet wide" onSubmit={onSubmit}>
        <div className="camera-head">
          <h2>Import inventory</h2>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">
          Choose a project, then map spreadsheet columns (or rows) onto device and layout fields. A Location column such as{" "}
          <code>A12 R09-RU19</code> can be mapped to “Location (parse row / rack / RU)” and is split into row A12, rack 09,
          and RU 19. Standalone U ranges like <code>U32-U38</code> or <code>U34</code> also parse as RU start/end. Chassis,
          shelf, and enclosure rows keep the U range on the elevation; components that share or sit inside that range nest
          under the parent instead of overlapping. Import follows Area → Row → Rack → Device and will not move populated
          items into a different parent. Empty cells do not blank fields that are already filled. CSV, XLSX, and ODS are
          supported.
        </p>
        {error && <div className="error">{error}</div>}

        <div className="row">
          <label className="field">
            <span>Target project</span>
            <select value={pid} onChange={(e) => setPid(e.target.value ? Number(e.target.value) : "")} required>
              <option value="">Select a project…</option>
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.site_name ? ` · ${p.site_name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>CSV, XLSX, or ODS file</span>
            <input
              type="file"
              accept=".csv,.xlsx,.ods,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,text/csv"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
        </div>

        {pid !== "" && areas.length > 0 && (
          <label className="field">
            <span>Default area (used when the sheet has rows/aisles but no area column)</span>
            <select value={defaultAreaId} onChange={(e) => setDefaultAreaId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Create areas from the spreadsheet</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {preview && sheet && (
          <>
            {preview.sheets.length > 1 && (
              <>
                <label className="field">
                  <span>{allSheets ? "Preview / mapping sheet" : "Sheet"}</span>
                  <select value={sheetName} onChange={(e) => onSheetChange(e.target.value)}>
                    {preview.sheets.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} ({s.record_count} records, {s.mapped_fields.length} fields guessed)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={allSheets} onChange={(e) => setAllSheets(e.target.checked)} />
                  <span>
                    Import every sheet in this file. Named sheets become areas (or rows if a default area is set) unless
                    the name is generic, such as Devices, Cover, Inventory, or Sheet1.
                  </span>
                </label>
              </>
            )}
            <div className="row">
              <label className="field">
                <span>Layout</span>
                <select value={orientation} onChange={(e) => onOrientationChange(e.target.value as "rows" | "columns")}>
                  <option value="rows">Records in rows (typical table)</option>
                  <option value="columns">Records in columns (one device per column)</option>
                </select>
              </label>
              <label className="field">
                <span>{orientation === "rows" ? "Header row" : "Header column"}</span>
                <input
                  type="number"
                  min={1}
                  value={headerIndex + 1}
                  onChange={(e) => onHeaderRowChange(Math.max(0, Number(e.target.value) - 1))}
                />
              </label>
            </div>
            <p className="muted">
              {sheet.record_count} record{sheet.record_count === 1 ? "" : "s"} on “{sheet.name}”. Map each spreadsheet
              heading to a DCEngineer field, or leave as skip.
              {locationMapped
                ? " Location values like A12 R09-RU19 or U32-U38 become row, rack, and RU unless those columns are mapped separately. Chassis and shelf components nest instead of overlapping."
                : ""}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Spreadsheet</th>
                    <th>Import as</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.headers.map((header) => (
                    <tr key={header.index}>
                      <td>{header.label || `Column ${header.index + 1}`}</td>
                      <td>
                        <select
                          value={headerMap[header.index] || ""}
                          onChange={(e) => setHeaderMap((m) => ({ ...m, [header.index]: e.target.value }))}
                        >
                          <option value="">Skip</option>
                          {fields.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {samples.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <h3>Preview (first {samples.length})</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {previewFields.map((f) => (
                          <th key={f.id}>{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {samples.map((rec, i) => (
                        <tr key={i}>
                          {previewFields.map((f) => (
                            <td key={f.id}>{rec[f.id] || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        <button className="btn primary block" disabled={busy || !file || pid === "" || mappedCount === 0} style={{ marginTop: 16 }}>
          {busy ? "Working…" : "Import into project"}
        </button>
      </form>
    </div>
  );
}
