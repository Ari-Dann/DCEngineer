import { useEffect, useState } from "react";
import { RestrictionType, RestrictionHit, RESTRICTION_TYPES, Restrictable, restrictionTypeOf } from "../restriction";

type Scope = "project" | "area" | "row" | "rack" | "device";

type Props = {
  name: string;
  value: RestrictionType;
  onChange: (next: RestrictionType) => void;
  inherited?: RestrictionHit[];
  scope?: Scope;
  entityName?: string;
  compact?: boolean;
  disabled?: boolean;
};

const TYPE_LABEL: Record<(typeof RESTRICTION_TYPES)[number], string> = {
  government: "Government",
  EMSS: "EMSS",
  other: "Other",
};

function typeLabel(value: RestrictionType) {
  if (value === "government" || value === "EMSS" || value === "other") return TYPE_LABEL[value];
  return value;
}

export default function RestrictionPicker({
  name,
  value,
  onChange,
  inherited = [],
  scope,
  entityName,
  compact = false,
  disabled = false,
}: Props) {
  const on = Boolean(value);
  const where = [scope, entityName].filter(Boolean).join(" ");
  const switchText = where
    ? `Restricted — ${where} only`
    : "Restricted (government / EMSS) — no photos";
  return (
    <div
      className={`restriction-picker${compact ? " compact" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <label className="switch-row">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={disabled}
          aria-label={switchText}
          onChange={(e) => onChange(e.target.checked ? "government" : "")}
        />
        <span>{switchText}</span>
      </label>
      {on && (
        <div className="choice compact restriction-choices" role="radiogroup" aria-label="Restriction type">
          {RESTRICTION_TYPES.map((id) => (
            <label key={id} className={`check-row ${value === id ? "on" : ""}`}>
              <input
                type="radio"
                name={name}
                checked={value === id}
                disabled={disabled}
                onChange={() => onChange(id)}
              />
              <span>{TYPE_LABEL[id]}</span>
            </label>
          ))}
        </div>
      )}
      {(on || inherited.length > 0) && !compact && (
        <p className="banner">
          {on
            ? scope === "row" || scope === "rack"
              ? `Tagged ${typeLabel(value)} on this ${scope} only — other ${scope}s stay open unless you tag them too. Do not photograph this or anything inside. `
              : `Tagged ${typeLabel(value)} — do not photograph this or anything inside. `
            : ""}
          {inherited.length > 0
            ? `Photos also blocked because ${inherited.map((hit) => `${hit.label} is ${hit.type}`).join(", ")}.`
            : ""}
        </p>
      )}
    </div>
  );
}

type SavedProps = {
  name: string;
  entity: Restrictable & { id: number; name: string };
  inherited?: RestrictionHit[];
  scope: "area" | "row" | "rack";
  compact?: boolean;
  onPersist: (type: RestrictionType) => Promise<void>;
};

export function SavedRestrictionPicker({ name, entity, inherited, scope, compact, onPersist }: SavedProps) {
  const [value, setValue] = useState<RestrictionType>(() => restrictionTypeOf(entity));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(restrictionTypeOf(entity));
  }, [entity.id, entity.restriction_type, entity.restricted, entity.restricted_reason, entity.photography_allowed]);

  async function change(next: RestrictionType) {
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      await onPersist(next);
    } catch {
      setValue(prev);
    } finally {
      setBusy(false);
    }
  }

  return (
    <RestrictionPicker
      name={name}
      value={value}
      onChange={change}
      inherited={inherited}
      scope={scope}
      entityName={entity.name}
      compact={compact}
      disabled={busy}
    />
  );
}
