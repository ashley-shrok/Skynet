import { KitSlider } from "@/components/kit";

// Hue picker: the kit slider over a rainbow track, a swatch of the picked
// colour, and the degree readout. The track gradient is the one inline
// style the kit can't supply — it *is* the control's content.
const HUE_TRACK =
  "linear-gradient(to right, hsl(0,70%,50%), hsl(60,70%,50%), hsl(120,70%,50%), hsl(180,70%,50%), hsl(240,70%,50%), hsl(300,70%,50%), hsl(360,70%,50%))";

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
    <div className="flex items-center gap-2.5 min-w-0">
      <KitSlider
        id={id ?? "color-picker"}
        min={0}
        max={360}
        step={1}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        aria-label={id ? undefined : "Hue"}
        className="flex-1 min-w-0 !h-2.5"
        style={{ background: HUE_TRACK }}
      />
      <span
        data-testid="color-swatch"
        aria-hidden="true"
        className="size-6 shrink-0 rounded-full border border-[var(--k-hair2)]"
        style={{ background: `hsl(${value}, 65%, 55%)` }}
      />
      <span className="text-[12px] text-[var(--k-t2)] min-w-8 text-right tabular-nums">
        {value}°
      </span>
    </div>
  );
}
