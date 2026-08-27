export type SelectMode = "one" | "many";

export function SelectModeToggle({
  mode,
  onChange,
}: {
  mode: SelectMode;
  onChange: (mode: SelectMode) => void;
}) {
  return (
    <fieldset className="select-mode">
      <legend>Select items</legend>
      <label>
        <input type="radio" name="select-mode" checked={mode === "one"} onChange={() => onChange("one")} />
        Individual
      </label>
      <label>
        <input type="radio" name="select-mode" checked={mode === "many"} onChange={() => onChange("many")} />
        Bulk
      </label>
    </fieldset>
  );
}

export function ItemSelect({
  mode,
  group,
  id,
  selected,
  onChange,
}: {
  mode: SelectMode;
  group: string;
  id: number;
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const checked = selected.includes(id);
  return (
    <input
      className="item-select"
      type={mode === "one" ? "radio" : "checkbox"}
      name={mode === "one" ? group : undefined}
      checked={checked}
      onChange={() => {
        if (mode === "one") onChange(checked ? [] : [id]);
        else onChange(checked ? selected.filter((value) => value !== id) : [...selected, id]);
      }}
      onClick={(e) => e.stopPropagation()}
      aria-label="Select item"
    />
  );
}

export function SelectionToolbar({
  noun,
  selectedCount,
  total,
  onSelectAll,
  onClear,
  onEdit,
  onMove,
  onDelete,
  onCopy,
}: {
  noun: string;
  selectedCount: number;
  total: number;
  onSelectAll?: () => void;
  onClear: () => void;
  onEdit?: () => void;
  onMove: () => void;
  onDelete: () => void;
  onCopy?: () => void;
}) {
  if (selectedCount === 0) {
    return (
      <div className="bulk-bar muted">
        {onSelectAll ? (
          <button type="button" className="btn" onClick={onSelectAll}>
            Select all {total} {noun}
            {total === 1 ? "" : "s"}
          </button>
        ) : (
          <span>Select an item to edit, move, or delete.</span>
        )}
      </div>
    );
  }
  return (
    <div className="bulk-bar">
      <strong>
        {selectedCount} {noun}
        {selectedCount === 1 ? "" : "s"} selected
      </strong>
      <span className="grow" />
      {onSelectAll && selectedCount < total && (
        <button type="button" className="btn" onClick={onSelectAll}>
          Select all
        </button>
      )}
      <button type="button" className="btn" onClick={onClear}>
        Clear
      </button>
      {onEdit && (
        <button type="button" className="btn" onClick={onEdit} disabled={selectedCount !== 1}>
          Edit
        </button>
      )}
      {onCopy && (
        <button type="button" className="btn" onClick={onCopy}>
          Copy
        </button>
      )}
      <button type="button" className="btn" onClick={onMove}>
        Move
      </button>
      <button type="button" className="btn danger" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
