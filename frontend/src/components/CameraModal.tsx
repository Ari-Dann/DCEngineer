import { ChangeEvent, useEffect, useRef, useState } from "react";
import { recognizeLabel } from "../ocr";

type Mode = "scan" | "photo";

type Props = {
  mode: Mode;
  title?: string;
  initialHint?: string;
  ocr?: boolean;
  onClose: () => void;
  onScan?: (value: string) => void;
  onPhoto?: (file: File) => void;
};

type DetectorCtor = new (opts: { formats: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
};

export default function CameraModal({ mode, title, initialHint, ocr = false, onClose, onScan, onPhoto }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState(
    initialHint ??
      (mode === "scan"
        ? ocr
          ? "Point the camera at a barcode, QR code, or printed serial"
          : "Point the camera at the barcode or QR code"
        : "Frame the equipment, then capture"),
  );
  const [busy, setBusy] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);

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
        setError(err instanceof Error ? err.message : "Camera permission denied");
        if (ocr && mode === "scan") {
          setHint("No camera in this browser. Use a photo of the barcode, QR code, or printed label.");
        }
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [mode]);

  function stop() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function startScan() {
    const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Detector) {
      setHint(
        ocr
          ? "Live barcode detection is not available. Frame the label and tap Read text, or use a photo."
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
        ocr
          ? "This browser cannot decode barcodes live. Frame the label and tap Read text, or use a photo."
          : "This browser opened the camera but cannot decode barcodes. Line up the tag, then type the code.",
      );
      return;
    }
    timerRef.current = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      try {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue) {
          stop();
          onScan?.(codes[0].rawValue.trim());
          onClose();
        }
      } catch {
        /* keep scanning */
      }
    }, 250);
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
      stop();
      onPhoto?.(file);
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

  async function finishScan(value: string) {
    const next = value.trim();
    if (!next) {
      setError("No barcode, QR, or readable text found. Move closer or type it.");
      return;
    }
    stop();
    onScan?.(next);
    onClose();
  }

  async function readTextFromCamera() {
    setBusy(true);
    setError("");
    try {
      const blob = await frameBlob();
      await finishScan(await recognizeLabel(blob));
    } catch (err) {
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
      await finishScan(await recognizeLabel(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read text");
    } finally {
      setBusy(false);
    }
  }

  const scanTitle = ocr ? "Scan barcode, QR, or text" : "Scan barcode or QR";

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
        <p className="muted">Photos stay in DCEngineer. Nothing is written to the device gallery.</p>
        <div className="camera-actions">
          {mode === "photo" && (
            <button type="button" className="btn primary block" disabled={busy} onClick={captureStill}>
              {busy ? "Saving…" : "Capture"}
            </button>
          )}
          {mode === "scan" && ocr && (
            <>
              <button type="button" className="btn primary block" disabled={busy || !hasVideo} onClick={readTextFromCamera}>
                {busy ? "Reading text…" : "Read text"}
              </button>
              <button type="button" className="btn block" disabled={busy} onClick={() => fileRef.current?.click()}>
                Use a photo
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={readTextFromFile}
              />
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
