import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  ipCandidatesFromText,
  recognizeCandidates,
  uniqueScanValues,
  type ScanKind,
} from "../ocr";

type Mode = "scan" | "photo";

type Props = {
  mode: Mode;
  title?: string;
  initialHint?: string;
  ocr?: boolean;
  scanKind?: ScanKind;
  onClose: () => void;
  onScan?: (value: string) => void;
  onPhoto?: (file: File) => void | Promise<void>;
};

type DetectorCtor = new (opts: { formats: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
};

const SCAN_COPY: Record<ScanKind, { title: string; hint: string; empty: string }> = {
  serial: {
    title: "Scan serial",
    hint: "Point the camera at a barcode, QR code, or printed serial. If several values appear, choose one.",
    empty: "No serial found. Move closer or type it.",
  },
  asset_tag: {
    title: "Scan asset tag",
    hint: "Point the camera at an asset-tag barcode or printed tag. If several values appear, choose one.",
    empty: "No asset tag found. Move closer or type it.",
  },
  management_ip: {
    title: "Scan management IP",
    hint: "Frame the management IP address, then tap Read text. Barcodes are used only when they contain an IP. If several addresses appear, choose one.",
    empty: "No IP address found. Move closer or type it.",
  },
  search: {
    title: "Scan barcode, QR, or text",
    hint: "Point the camera at a barcode, QR code, or printed serial. If several values appear, choose one.",
    empty: "No barcode, QR, or readable text found. Move closer or type it.",
  },
};

export default function CameraModal({
  mode,
  title,
  initialHint,
  ocr = false,
  scanKind = "search",
  onClose,
  onScan,
  onPhoto,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const copy = SCAN_COPY[scanKind];
  const useOcr = ocr || scanKind === "management_ip" || scanKind === "asset_tag";
  const [error, setError] = useState("");
  const [hint, setHint] = useState(
    initialHint ??
      (mode === "scan"
        ? useOcr
          ? copy.hint
          : "Point the camera at the barcode or QR code. If several codes appear, choose one."
        : "Frame the equipment, then capture"),
  );
  const [busy, setBusy] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [choices, setChoices] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setHasVideo(true);
        if (mode === "scan") startScan();
      } catch (err) {
        setHasVideo(false);
        const name = err instanceof DOMException ? err.name : "";
        const raw = err instanceof Error ? err.message : "Camera permission denied";
        const noCamera = /NotFoundError|DevicesNotFound|not found/i.test(`${name} ${raw}`);
        setError(noCamera ? "" : raw);
        if (useOcr && mode === "scan") {
          setHint("No camera in this browser. Use a photo of the barcode, QR code, or printed label.");
        } else if (noCamera) {
          setHint("No camera in this browser. Line up the tag, then type the code.");
        }
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [mode]);

  function stop() {
    pausedRef.current = false;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function pauseLiveScan() {
    pausedRef.current = true;
  }

  function keepScanning() {
    pausedRef.current = false;
    setChoices([]);
    setError("");
    setHint(initialHint ?? (useOcr ? copy.hint : "Point the camera at the barcode or QR code. If several codes appear, choose one."));
  }

  function startScan() {
    const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Detector) {
      setHint(
        useOcr
          ? scanKind === "management_ip"
            ? "Live barcode detection is not available. Frame the IP address and tap Read text, or use a photo."
            : "Live barcode detection is not available. Frame the label and tap Read text, or use a photo."
          : "Live barcode detection is not available in this browser. Keep this window open to line up the tag, then type the code.",
      );
      return;
    }
    let detector: InstanceType<DetectorCtor>;
    try {
      detector = new Detector({
        formats: ["code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code", "itf", "data_matrix"],
      });
    } catch {
      setHint(
        useOcr
          ? "This browser cannot decode barcodes live. Frame the label and tap Read text, or use a photo."
          : "This browser opened the camera but cannot decode barcodes. Line up the tag, then type the code.",
      );
      return;
    }
    timerRef.current = window.setInterval(async () => {
      const video = videoRef.current;
      if (pausedRef.current || !video || video.readyState < 2) return;
      try {
        const codes = await detector.detect(video);
        const values =
          scanKind === "management_ip"
            ? uniqueScanValues(codes.flatMap((code) => ipCandidatesFromText(code.rawValue || "")))
            : uniqueScanValues(codes.map((code) => code.rawValue || ""));
        if (!values.length) return;
        offerCandidates(values);
      } catch {
        /* keep scanning */
      }
    }, 250);
  }

  function applyValue(value: string) {
    const next = value.trim();
    if (!next) {
      setError(copy.empty);
      return;
    }
    stop();
    onScan?.(next);
    onClose();
  }

  function offerCandidates(values: string[]) {
    const unique = uniqueScanValues(values);
    if (!unique.length) {
      setError(copy.empty);
      pausedRef.current = false;
      return;
    }
    if (unique.length === 1) {
      applyValue(unique[0]);
      return;
    }
    pauseLiveScan();
    setError("");
    setChoices(unique);
    setHint("Several values found. Choose one before the field is filled.");
  }

  async function captureStill() {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Capture failed"))), "image/jpeg", 0.88);
      });
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
      await onPhoto?.(file);
      stop();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  }

  async function frameBlob(): Promise<Blob> {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      throw new Error("Camera is not ready");
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Capture failed"))), "image/jpeg", 0.92);
    });
  }

  async function readCandidates(input: Blob) {
    pauseLiveScan();
    offerCandidates(await recognizeCandidates(input, scanKind));
  }

  async function readTextFromCamera() {
    setBusy(true);
    setError("");
    try {
      const blob = await frameBlob();
      await readCandidates(blob);
    } catch (err) {
      pausedRef.current = false;
      setError(err instanceof Error ? err.message : "Could not read text");
    } finally {
      setBusy(false);
    }
  }

  async function readTextFromFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await readCandidates(file);
    } catch (err) {
      pausedRef.current = false;
      setError(err instanceof Error ? err.message : "Could not read text");
    } finally {
      setBusy(false);
    }
  }

  const scanTitle = useOcr ? copy.title : "Scan barcode or QR";

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="camera-sheet">
        <div className="camera-head">
          <strong>{title ?? (mode === "scan" ? scanTitle : "Capture photo")}</strong>
          <button type="button" className="btn" onClick={() => { stop(); onClose(); }}>Close</button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="viewfinder">
          <video ref={videoRef} playsInline muted autoPlay />
          <div className="reticle" />
        </div>
        <p className="muted">{hint}</p>
        {choices.length > 0 && (
          <div className="scan-choices" role="listbox" aria-label="Scan matches">
            {choices.map((value) => (
              <button key={value} type="button" className="btn" role="option" onClick={() => applyValue(value)}>
                {value}
              </button>
            ))}
            <button type="button" className="btn" onClick={keepScanning}>
              Keep scanning
            </button>
          </div>
        )}
        <p className="muted">Photos stay in DCEngineer. Nothing is written to the device gallery.</p>
        <div className="camera-actions">
          {mode === "photo" && (
            <button type="button" className="btn primary block" disabled={busy} onClick={captureStill}>
              {busy ? "Saving…" : "Capture"}
            </button>
          )}
          {mode === "scan" && useOcr && (
            <>
              <button type="button" className="btn primary block" disabled={busy || !hasVideo} onClick={readTextFromCamera}>
                {busy ? "Reading text…" : "Read text"}
              </button>
              <label className="btn block">
                Use a photo
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.png,.jpg,.jpeg,.webp"
                  hidden
                  disabled={busy}
                  onChange={readTextFromFile}
                />
              </label>
            </>
          )}
          {mode === "scan" && (
            <button type="button" className="btn block" disabled={busy} onClick={() => { stop(); onClose(); }}>
              Type it instead
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
