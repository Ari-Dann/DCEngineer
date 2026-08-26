import { FormEvent, useMemo, useState } from "react";
import {
  ImportField,
  ImportPreview,
  ImportPreviewSheet,
  ImportResult,
  Project,
  projects,
} from "../api";
import { invalidateCatalog } from "../catalog";

type HeaderMap = Record<number, string>;

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
    return rec;
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
  onClose,
  onImported,
}: {
  projectList: Project[];
  projectId?: number;
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const sheet = preview?.sheets.find((s) => s.name === sheetName) || preview?.sheets[0];
  const fields: ImportField[] = preview?.fields || [];
  const samples = useMemo(() => (sheet ? sampleRecords(sheet, headerMap) : []), [sheet, headerMap]);
  const mappedCount = Object.values(headerMap).filter(Boolean).length;

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
    if (!mapping.name && !mapping.hostname && !mapping.serial) {
      setError("Map at least Device name, Hostname, or Serial so rows can be created.");
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
          Choose an existing project, then map spreadsheet columns (or rows) onto device fields. Records without a name,
          hostname, or serial are skipped.
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
            <span>CSV or XLSX file</span>
            <input
              type="file"
              accept=".csv,.xlsx,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
        </div>

        {preview && sheet && (
          <>
            {preview.sheets.length > 1 && (
              <label className="field">
                <span>Sheet</span>
                <select value={sheetName} onChange={(e) => onSheetChange(e.target.value)}>
                  {preview.sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.record_count} records, {s.mapped_fields.length} fields guessed)
                    </option>
                  ))}
                </select>
              </label>
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
                        {fields
                          .filter((f) => Object.values(headerMap).includes(f.id))
                          .map((f) => (
                            <th key={f.id}>{f.label}</th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {samples.map((rec, i) => (
                        <tr key={i}>
                          {fields
                            .filter((f) => Object.values(headerMap).includes(f.id))
                            .map((f) => (
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
