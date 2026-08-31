import { RestrictionType, RestrictionHit, RESTRICTION_TYPES } from "../restriction";

type Props = {
  name: string;
  value: RestrictionType;
  onChange: (next: RestrictionType) => void;
  inherited?: RestrictionHit[];
  compact?: boolean;
  noun?: string;
};

const TYPE_LABEL: Record<(typeof RESTRICTION_TYPES)[number], string> = {
  government: "Government",
  EMSS: "EMSS",
  other: "Other",
};

const COMPACT_OPTIONS: { id: RestrictionType; label: string }[] = [
  { id: "", label: "Photos OK" },
  { id: "government", label: "Government" },
  { id: "EMSS", label: "EMSS" },
];

export default function RestrictionPicker({
  name,
  value,
  onChange,
  inherited = [],
  compact = false,
  noun = "item",
}: Props) {
  if (compact) {
    return (
      <div
        className="restriction-inline"
        role="radiogroup"
        aria-label={`Government / EMSS for this ${noun} only`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="muted restriction-inline-label">This {noun} only</span>
        {COMPACT_OPTIONS.map((opt) => (
          <label key={opt.id || "ok"} className={`restriction-chip ${value === opt.id ? "on" : ""}`}>
            <input type="radio" name={name} checked={value === opt.id} onChange={() => onChange(opt.id)} />
            {opt.label}
          </label>
        ))}
      </div>
    );
  }

  const on = Boolean(value);
  const typeLabel = on ? TYPE_LABEL[value as (typeof RESTRICTION_TYPES)[number]] || value : "";
  return (
    <div className="restriction-picker">
      <label className="switch-row">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? "government" : "")}
        />
        <span>Restricted (government / EMSS) — no photos of this {noun}</span>
      </label>
      {on && (
        <div className="choice compact restriction-choices" role="radiogroup" aria-label="Restriction type">
          {RESTRICTION_TYPES.map((id) => (
            <label key={id} className={`check-row ${value === id ? "on" : ""}`}>
              <input type="radio" name={name} checked={value === id} onChange={() => onChange(id)} />
              <span>{TYPE_LABEL[id]}</span>
            </label>
          ))}
        </div>
      )}
      {(on || inherited.length > 0) && (
        <p className="banner">
          {on ? `Tagged ${typeLabel} — no photos of this ${noun}. ` : ""}
          {inherited.length > 0
            ? `Photos also blocked because ${inherited.map((hit) => `${hit.label} is ${hit.type}`).join(", ")}.`
            : ""}
        </p>
      )}
    </div>
  );
}
