import { RestrictionType, RestrictionHit, RESTRICTION_TYPES } from "../restriction";

type Props = {
  name: string;
  value: RestrictionType;
  onChange: (next: RestrictionType) => void;
  inherited?: RestrictionHit[];
};

const TYPE_LABEL: Record<(typeof RESTRICTION_TYPES)[number], string> = {
  government: "Government",
  EMSS: "EMSS",
  other: "Other",
};

export default function RestrictionPicker({ name, value, onChange, inherited = [] }: Props) {
  const on = Boolean(value);
  return (
    <div className="restriction-picker">
      <label className="switch-row">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? "government" : "")}
        />
        <span>Restricted (government / EMSS) — no photos</span>
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
          {on ? `Tagged ${TYPE_LABEL[value as (typeof RESTRICTION_TYPES)[number]] || value} — do not photograph this or anything inside. ` : ""}
          {inherited.length > 0
            ? `Also blocked by ${inherited.map((hit) => `${hit.label} (${hit.type})`).join(", ")}.`
            : ""}
        </p>
      )}
    </div>
  );
}
