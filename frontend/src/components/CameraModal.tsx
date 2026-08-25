import { useEffect, useRef, useState } from "react";

type Mode = "scan" | "photo";

type Props = {
  mode: Mode;
  onClose: () => void;
  onScan?: (value: string) => void;
  onPhoto?: (file: File) => void;
};

type DetectorCtor = new (opts: { formats: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
};

export default function CameraModal({ mode, onClose, onScan, onPhoto }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState(mode === "scan" ? "Point the camera at the barcode or serial" : "Frame the equipment, then capture");
  const [busy, setBusy] = useState(false);

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
        if (mode === "scan") startScan();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Camera permission denied");
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
      setHint("Live barcode detection is not available in this browser. Keep this window open to line up the tag, then type the serial.");
      return;
    }
    let detector: InstanceType<DetectorCtor>;
    try {
      detector = new Detector({
        formats: ["code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code", "itf", "data_matrix"],
      });
    } catch {
      setHint("This browser opened the camera but cannot decode barcodes. Line up the tag, then type the serial.");
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

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="camera-sheet">
        <div className="camera-head">
          <strong>{mode === "scan" ? "Scan serial" : "Capture photo"}</strong>
          <button type="button" className="btn" onClick={() => { stop(); onClose(); }}>Close</button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="viewfinder">
          <video ref={videoRef} playsInline muted autoPlay />
          <div className="reticle" />
        </div>
        <p className="muted">{hint}</p>
        <p className="muted">Photos stay in DCEngineer. Nothing is written to the device gallery.</p>
        <div style={{ display: "flex", gap: 8 }}>
          {mode === "photo" && (
            <button type="button" className="btn primary block" disabled={busy} onClick={captureStill}>
              {busy ? "Saving…" : "Capture"}
            </button>
          )}
          {mode === "scan" && (
            <button type="button" className="btn block" onClick={() => { stop(); onClose(); }}>
              Type it instead
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
