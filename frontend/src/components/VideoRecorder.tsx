import { useEffect, useRef, useState } from "react";

type Props = {
  title?: string;
  hint?: string;
  onClose: () => void;
  onCapture: (file: File) => void;
};

function recorderMime(): string {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return candidates.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) || "";
}

export default function VideoRecorder({ title = "Record clip", hint, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Camera permission denied");
      }
    })();
    return () => {
      cancelled = true;
      stopAll();
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  function stopAll() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function start() {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = recorderMime();
    if (!mime || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record video. Capture stills instead.");
      return;
    }
    chunksRef.current = [];
    setSeconds(0);
    const rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (ev) => {
      if (ev.data.size) chunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `aisle-${Date.now()}.${ext}`, { type: blob.type });
      stopAll();
      onCapture(file);
      onClose();
    };
    recorderRef.current = rec;
    rec.start(250);
    setRecording(true);
  }

  function finish() {
    setRecording(false);
    recorderRef.current?.stop();
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="camera-sheet">
        <div className="camera-head">
          <strong>{title}</strong>
          <button
            type="button"
            className="btn"
            onClick={() => {
              stopAll();
              onClose();
            }}
          >
            Close
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="viewfinder">
          <video ref={videoRef} playsInline muted autoPlay />
        </div>
        <p className="muted">{hint || "Keep clips short (under 20s). Original video stays on this session as evidence."}</p>
        {recording && <p className="muted">Recording… {seconds}s</p>}
        <div style={{ display: "flex", gap: 8 }}>
          {!recording ? (
            <button type="button" className="btn primary block" onClick={start} disabled={Boolean(error)}>
              Start recording
            </button>
          ) : (
            <button type="button" className="btn warn block" onClick={finish}>
              Stop & attach
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
