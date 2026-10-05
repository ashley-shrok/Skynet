import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { MultiSelect } from "./multi-select";

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

function Harness({ onChange }: { onChange?: (v: string[]) => void }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <MultiSelect
      ariaLabel="Things"
      placeholder="Pick things…"
      options={OPTIONS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe("MultiSelect", () => {
  it("shows the placeholder, then picked options as pills in pick order; list stays open", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Things" });
    expect(trigger.textContent).toContain("Pick things…");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /Gamma/ }));
    fireEvent.click(screen.getByRole("option", { name: /Alpha/ }));
    expect(onChange).toHaveBeenLastCalledWith(["c", "a"]);
    expect(screen.getByRole("listbox", { name: "Things" })).toBeTruthy();
    expect(
      screen.getByRole("option", { name: /Gamma/ }).getAttribute("aria-selected"),
    ).toBe("true");
    const pills = Array.from(trigger.querySelectorAll("[data-selected-value]")).map(
      (el) => el.textContent,
    );
    expect(pills).toEqual(["Gamma", "Alpha"]);
  });

  it("clicking a picked option un-picks it", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Things" }));
    fireEvent.click(screen.getByRole("option", { name: /Beta/ }));
    fireEvent.click(screen.getByRole("option", { name: /Beta/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("disabled trigger does not open", () => {
    render(
      <MultiSelect ariaLabel="Things" options={OPTIONS} value={[]} onChange={() => {}} disabled />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Things" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
