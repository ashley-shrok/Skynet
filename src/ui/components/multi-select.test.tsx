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

  it("leadingAction renders above the options, closes the list and fires", () => {
    const onSelect = vi.fn();
    render(
      <MultiSelect
        ariaLabel="Things"
        options={OPTIONS}
        value={[]}
        onChange={() => {}}
        leadingAction={{ label: "New thing…", onSelect }}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Things" }));
    const action = screen.getByRole("button", { name: /New thing/ });
    // Not an option: picks are unaffected and it sits before the listbox.
    expect(action.getAttribute("role")).toBeNull();
    expect(
      action.compareDocumentPosition(screen.getByRole("listbox", { name: "Things" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(action);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox", { name: "Things" })).toBeNull();
  });

  // ─── Grouped options (host sections in the new-agent Roles dropdown) ───
  const GROUPED = [
    { value: "h1/a", label: "Alpha", group: "box-one", pillLabel: "Alpha · box-one" },
    { value: "h1/b", label: "Beta", group: "box-one", pillLabel: "Beta · box-one" },
    { value: "h2/a", label: "Alpha", group: "box-two", pillLabel: "Alpha · box-two" },
    { value: "h2/c", label: "Gamma", group: "box-two", pillLabel: "Gamma · box-two" },
    { value: "h3/d", label: "Delta", group: "box-three", pillLabel: "Delta · box-three" },
    { value: "h3/e", label: "Epsilon", group: "box-three", pillLabel: "Epsilon · box-three" },
    { value: "h3/f", label: "Zeta", group: "box-three", pillLabel: "Zeta · box-three" },
  ];

  function GroupedHarness() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <MultiSelect ariaLabel="Things" options={GROUPED} value={value} onChange={setValue} />
    );
  }

  /** Listbox rows in DOM order: "# <group>" for headers, the value for options. */
  function listRows(): string[] {
    const list = screen.getByRole("listbox", { name: "Things" });
    return Array.from(
      list.querySelectorAll<HTMLElement>('[data-testid="multi-select-group"], [role="option"]'),
    ).map((el) =>
      el.dataset.testid === "multi-select-group"
        ? `# ${el.textContent}`
        : (el.dataset.value ?? ""),
    );
  }

  it("draws one header row wherever the group changes, before that group's options", () => {
    render(<GroupedHarness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Things" }));
    expect(listRows()).toEqual([
      "# box-one",
      "h1/a",
      "h1/b",
      "# box-two",
      "h2/a",
      "h2/c",
      "# box-three",
      "h3/d",
      "h3/e",
      "h3/f",
    ]);
    // Headers are not options — they can't be picked.
    for (const h of screen.getAllByTestId("multi-select-group")) {
      expect(h.getAttribute("role")).toBeNull();
    }
  });

  it("no headers for a flat (ungrouped) list", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Things" }));
    expect(screen.queryAllByTestId("multi-select-group")).toHaveLength(0);
  });

  it("pills use pillLabel when given; the list row keeps label", () => {
    render(<GroupedHarness />);
    const trigger = screen.getByRole("combobox", { name: "Things" });
    fireEvent.click(trigger);
    const row = screen
      .getAllByRole("option")
      .find((o) => o.dataset.value === "h2/a")!;
    expect(row.textContent).toBe("Alpha");
    fireEvent.click(row);
    const pills = Array.from(trigger.querySelectorAll("[data-selected-value]")).map(
      (el) => [(el as HTMLElement).dataset.selectedValue, el.textContent],
    );
    expect(pills).toEqual([["h2/a", "Alpha · box-two"]]);
  });

  it("filter matches a group's name and keeps that whole section with its header", () => {
    render(<GroupedHarness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Things" }));
    // >6 options → the filter input renders.
    const filter = screen.getByLabelText("Filter things");
    fireEvent.change(filter, { target: { value: "box-two" } });
    expect(listRows()).toEqual(["# box-two", "h2/a", "h2/c"]);
  });

  it("filter by label keeps matches from every group, each under its own header", () => {
    render(<GroupedHarness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Things" }));
    fireEvent.change(screen.getByLabelText("Filter things"), {
      target: { value: "alpha" },
    });
    expect(listRows()).toEqual(["# box-one", "h1/a", "# box-two", "h2/a"]);
  });
});
