import { FormEvent, useState } from "react";

export function PromptDialog({
  title,
  label,
  initial,
  confirmLabel = "Save",
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  initial: string;
  confirmLabel?: string;
  onClose: () => void;
  onSave: (value: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) {
      setError(`${label} is required.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <form className="sheet" onSubmit={onSubmit}>
        <div className="camera-head">
          <h2>{title}</h2>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <label className="field">
          <span>{label}</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus required />
        </label>
        <button className="btn primary block" disabled={busy}>
          {busy ? "Saving…" : confirmLabel}
        </button>
      </form>
    </div>
  );
}
