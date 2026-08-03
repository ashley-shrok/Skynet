export function ColorPicker({
  value,
  onChange,
  disabled,
  id,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        id={id ?? "color-picker"}
        type="range"
        min={0}
        max={360}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{
          flex: 1,
          height: 10,
          borderRadius: 5,
          appearance: "none",
          WebkitAppearance: "none",
          background: "linear-gradient(to right, hsl(0,70%,50%), hsl(60,70%,50%), hsl(120,70%,50%), hsl(180,70%,50%), hsl(240,70%,50%), hsl(300,70%,50%), hsl(360,70%,50%))",
          outline: "none",
        }}
      />
      <div
        data-testid="color-swatch"
        style={{
          width: 24, height: 24, borderRadius: "50%",
          background: `hsl(${value}, 65%, 55%)`,
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
          flexShrink: 0,
        }}
      />
      <span className="text-xs text-[var(--color-pv-fg-muted)]" style={{ minWidth: 32, textAlign: "right" }}>
        {value}°
      </span>
    </div>
  );
}
