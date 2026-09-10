const BARCODE_FORMATS = [
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "qr_code",
  "itf",
  "data_matrix",
];

const LABEL =
  /^(?:s\/n|sn|serial(?:\s*number)?|p\/n|pn|part(?:\s*no(?:\.|umber)?)?|asset(?:\s*tag)?|tag|hostname|host|svc(?:\s*tag)?|service\s*tag)\s*[:#-]?\s*(.+)$/i;

export type OcrDeviceFields = {
  serial?: string;
  asset_tag?: string;
  hostname?: string;
  model?: string;
  name?: string;
};

const FIELD_PATTERNS: { key: keyof OcrDeviceFields; re: RegExp }[] = [
  { key: "serial", re: /^(?:s\/n|sn|serial(?:\s*(?:no\.?|number|#))?)\s*[:#-]?\s*(.+)$/i },
  { key: "asset_tag", re: /^(?:asset(?:\s*tag)?|svc(?:\s*tag)?|service\s*tag|tag)\s*[:#-]?\s*(.+)$/i },
  { key: "hostname", re: /^(?:host(?:name)?|dns)\s*[:#-]?\s*(.+)$/i },
  { key: "model", re: /^(?:model|p\/n|pn|part(?:\s*(?:no\.?|number))?)\s*[:#-]?\s*(.+)$/i },
  { key: "name", re: /^(?:name|device\s*name)\s*[:#-]?\s*(.+)$/i },
];

type Detector = { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;

function getDetector(name: "BarcodeDetector" | "TextDetector"): Detector | null {
  const Ctor = (window as unknown as Record<string, DetectorCtor | undefined>)[name];
  if (!Ctor) return null;
  try {
    return name === "BarcodeDetector" ? new Ctor({ formats: BARCODE_FORMATS }) : new Ctor();
  } catch {
    return null;
  }
}

export function scoreToken(token: string): number {
  const t = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  if (t.length < 4 || t.length > 32) return 0;
  const hasDigit = /[0-9]/.test(t);
  const hasLetter = /[A-Za-z]/.test(t);
  const hasSep = /[._\-\/]/.test(t);
  if (!hasDigit && !hasLetter) return 0;
  if (!hasDigit && !hasSep) return 0;
  let score = 0;
  if (hasDigit && hasLetter) score += 3;
  else if (hasDigit) score += 1;
  else score += 2;
  if (hasSep) score += 1;
  if (t.length >= 6) score += 1;
  return score;
}

function normalizeToken(token: string): string {
  return token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

/** Pick a serial-like query from noisy OCR / detector text. */
export function queryFromOcr(text: string): string {
  const cleaned = (text || "").replace(/\u0000/g, " ").trim();
  if (!cleaned) return "";
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(LABEL);
    if (match?.[1]) {
      const picked = pickLabeledValue(match[1]);
      if (picked) return picked;
    }
  }
  const tokens = cleaned.split(/[\s,;|]+/).map(normalizeToken).filter(Boolean);
  const ranked = [...tokens].sort((a, b) => scoreToken(b) - scoreToken(a));
  if (ranked[0] && scoreToken(ranked[0]) >= 2) return ranked[0];
  const short = lines.find((line) => line.length >= 3 && line.length <= 40);
  return (short || cleaned.replace(/\s+/g, " ")).slice(0, 64);
}

function pickLabeledValue(raw: string): string {
  const parts = raw.split(/[\s,;|]+/).map(normalizeToken).filter(Boolean);
  const ranked = [...parts].sort((a, b) => scoreToken(b) - scoreToken(a));
  if (ranked[0] && scoreToken(ranked[0]) > 0) return ranked[0];
  const rest = raw.trim();
  return rest.length >= 2 && rest.length <= 64 ? rest.slice(0, 64) : "";
}

/** Parse labeled device fields from OCR text (serial, asset tag, hostname, …). */
export function fieldsFromOcr(text: string): OcrDeviceFields {
  const cleaned = (text || "").replace(/\u0000/g, " ").trim();
  const out: OcrDeviceFields = {};
  if (!cleaned) return out;
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    for (const { key, re } of FIELD_PATTERNS) {
      if (out[key]) continue;
      const match = line.match(re);
      if (!match?.[1]) continue;
      const picked = pickLabeledValue(match[1]);
      if (picked) out[key] = picked;
    }
  }
  if (!out.serial) {
    const fallback = queryFromOcr(cleaned);
    if (fallback && fallback !== out.asset_tag && fallback !== out.hostname && fallback !== out.model) {
      out.serial = fallback;
    }
  }
  return out;
}

async function snapshot(source: ImageBitmapSource): Promise<Blob> {
  if (source instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => {
      source.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Capture failed"))), "image/jpeg", 0.92);
    });
  }
  const canvas = document.createElement("canvas");
  if (source instanceof HTMLVideoElement) {
    canvas.width = source.videoWidth || 1280;
    canvas.height = source.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  } else if (source instanceof HTMLImageElement) {
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  } else if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(source, 0, 0);
  } else {
    throw new Error("Unsupported image source");
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Capture failed"))), "image/jpeg", 0.92);
  });
}

let workerPromise: Promise<{ recognize: (image: Blob) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> }> | null =
  null;

async function ocrWithTesseract(image: Blob): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1).then(async (worker) => {
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      return worker;
    });
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  const worker = await workerPromise;
  const { data } = await worker.recognize(image);
  return data.text || "";
}

export type ScanKind = "serial" | "asset_tag" | "management_ip" | "search";

const IPV4 =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f:.]+\b/gi;

export function uniqueScanValues(values: string[], limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = (raw || "").replace(/\u0000/g, "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value.slice(0, 128));
    if (out.length >= limit) break;
  }
  return out;
}

function extractIps(text: string, found: string[]) {
  IPV4.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IPV4.exec(text))) found.push(match[0]);
  IPV6.lastIndex = 0;
  while ((match = IPV6.exec(text))) {
    const value = match[0];
    if ((value.match(/:/g) || []).length >= 2) found.push(value);
  }
}

export function ipCandidatesFromText(text: string): string[] {
  const cleaned = (text || "").replace(/\u0000/g, " ");
  if (!cleaned.trim()) return [];
  const found: string[] = [];
  for (const line of cleaned.split(/\r?\n/)) {
    const labeled = line.match(/^(?:ip(?:v4|v6)?|mgmt|management(?:\s*ip)?|mgmt\s*ip|address)\s*[:#-]?\s*(.+)$/i);
    if (labeled?.[1]) extractIps(labeled[1], found);
  }
  extractIps(cleaned, found);
  return uniqueScanValues(found);
}

export function scanCandidatesFromText(text: string, kind: ScanKind): string[] {
  if (kind === "management_ip") return ipCandidatesFromText(text);
  const cleaned = (text || "").replace(/\u0000/g, " ").trim();
  if (!cleaned) return [];
  const fields = fieldsFromOcr(cleaned);
  const found: string[] = [];
  if (kind === "asset_tag") {
    if (fields.asset_tag) found.push(fields.asset_tag);
    if (fields.serial) found.push(fields.serial);
  } else if (kind === "serial") {
    if (fields.serial) found.push(fields.serial);
    if (fields.asset_tag) found.push(fields.asset_tag);
  } else {
    if (fields.serial) found.push(fields.serial);
    if (fields.asset_tag) found.push(fields.asset_tag);
    if (fields.hostname) found.push(fields.hostname);
    if (fields.name) found.push(fields.name);
  }
  const tokens = cleaned.split(/[\s,;|]+/).map(normalizeToken).filter(Boolean);
  const ranked = [...new Set(tokens)].sort((a, b) => scoreToken(b) - scoreToken(a));
  for (const token of ranked) {
    if (scoreToken(token) >= 2) found.push(token);
  }
  if (kind === "search") {
    const fallback = queryFromOcr(cleaned);
    if (fallback) found.push(fallback);
  }
  return uniqueScanValues(found);
}

async function detectBarcodes(source: ImageBitmapSource): Promise<string[]> {
  try {
    const barcode = getDetector("BarcodeDetector");
    if (!barcode) return [];
    const codes = await barcode.detect(source);
    return uniqueScanValues(codes.map((code) => code.rawValue || ""));
  } catch {
    return [];
  }
}

async function detectText(source: ImageBitmapSource): Promise<string> {
  try {
    const text = getDetector("TextDetector");
    if (!text) return "";
    const hits = await text.detect(source);
    return hits.map((hit) => hit.rawValue).filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

/** Barcodes and OCR candidates for a specific field. Empty when nothing readable. */
export async function recognizeCandidates(input: ImageBitmapSource | Blob, kind: ScanKind): Promise<string[]> {
  const source = input instanceof Blob ? await createImageBitmap(input) : input;
  const found: string[] = [];
  const codes = await detectBarcodes(source);
  if (kind === "management_ip") {
    for (const code of codes) found.push(...ipCandidatesFromText(code));
  } else {
    found.push(...codes);
  }
  const blob = input instanceof Blob ? input : await snapshot(source);
  const combined = [await detectText(source), await ocrWithTesseract(blob)].filter(Boolean).join("\n");
  found.push(...scanCandidatesFromText(combined, kind));
  return uniqueScanValues(found);
}

export async function recognizeLabel(input: ImageBitmapSource | Blob): Promise<string> {
  const [first] = await recognizeCandidates(input, "search");
  return first || "";
}

/** Full barcode + OCR text from an image, for filling several device fields. */
export async function readImageText(input: ImageBitmapSource | Blob): Promise<string> {
  const source = input instanceof Blob ? await createImageBitmap(input) : input;
  const chunks: string[] = [];
  try {
    const barcode = getDetector("BarcodeDetector");
    if (barcode) {
      const codes = await barcode.detect(source);
      const value = codes[0]?.rawValue?.trim();
      if (value) chunks.push(value);
    }
  } catch {
    /* continue */
  }
  try {
    const text = getDetector("TextDetector");
    if (text) {
      const hits = await text.detect(source);
      const joined = hits.map((hit) => hit.rawValue).filter(Boolean).join("\n");
      if (joined) chunks.push(joined);
    }
  } catch {
    /* continue */
  }
  const blob = input instanceof Blob ? input : await snapshot(source);
  const tess = await ocrWithTesseract(blob);
  if (tess.trim()) chunks.push(tess);
  return chunks.join("\n");
}
