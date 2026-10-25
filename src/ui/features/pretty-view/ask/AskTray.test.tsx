import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AskTray } from "./AskTray";
import { parseAskBlock } from "./ask-format";
import type { QuestionAnswer } from "./answer-format";

function mount(body: string, extra: Partial<React.ComponentProps<typeof AskTray>> = {}) {
  const r = parseAskBlock(body);
  if (!r.ok) throw new Error(r.error);
  const onAnswer = vi.fn();
  render(<AskTray open={{ ask: r.ask, eventId: "e1", replaced: [] }} onAnswer={onAnswer} hostName="box" {...extra} />);
  const tray = within(screen.getByTestId("ask-tray"));
  const send = () => tray.getByTestId("ask-send") as HTMLButtonElement;
  const answers = (): QuestionAnswer[] => onAnswer.mock.calls[0]![1];
  return { tray, send, onAnswer, answers };
}

describe("AskTray — each kind of question", () => {
  it("pick several: ticks in the agent's order, Send waits for one", () => {
    const { tray, send, answers } = mount("question: Which?\nkind: pick-several\noptions: [a, b, c]");
    expect(send().disabled).toBe(true);
    act(() => { fireEvent.click(tray.getByRole("checkbox", { name: /c/ })); });
    act(() => { fireEvent.click(tray.getByRole("checkbox", { name: /a/ })); });
    act(() => { fireEvent.click(send()); });
    expect(answers()[0]).toMatchObject({ kind: "options", picked: [{ label: "a" }, { label: "c" }] });
  });

  it("put in order: answered from the start, arrows reorder", () => {
    const { tray, send, answers } = mount("question: Order?\nkind: order\nitems: [a, b, c]");
    expect(send().disabled).toBe(false);
    act(() => { fireEvent.click(tray.getByRole("button", { name: "Move c up" })); });
    act(() => { fireEvent.click(send()); });
    const a = answers()[0];
    expect(a.kind === "order" && a.ordered.map((o) => o.label)).toEqual(["a", "c", "b"]);
  });

  it("decide each: Send waits for every item", () => {
    const { tray, send, answers } = mount("question: Triage?\nkind: decide\nitems: [x, y]\nchoices: [Keep, Drop]");
    act(() => { fireEvent.click(within(tray.getByRole("radiogroup", { name: "x" })).getByRole("radio", { name: "Keep" })); });
    expect(send().disabled).toBe(true);
    act(() => { fireEvent.click(within(tray.getByRole("radiogroup", { name: "y" })).getByRole("radio", { name: "Drop" })); });
    act(() => { fireEvent.click(send()); });
    const a = answers()[0];
    expect(a.kind === "decide" && a.decided.map((d) => `${d.item.label}:${d.choice}`)).toEqual(["x:Keep", "y:Drop"]);
  });

  it("short text answers on Enter", () => {
    const t = mount("question: Name?\nkind: text");
    act(() => { fireEvent.change(t.tray.getByLabelText("Name?"), { target: { value: "thor" } }); });
    act(() => { fireEvent.keyDown(t.tray.getByLabelText("Name?"), { key: "Enter" }); });
    expect(t.answers()[0]).toEqual({ kind: "text", text: "thor" });
  });

  it("number respects min and max", () => {
    const n = mount("question: How many?\nkind: number\nmin: 1\nmax: 5");
    act(() => { fireEvent.change(n.tray.getByLabelText("How many?"), { target: { value: "9" } }); });
    expect(n.send().disabled).toBe(true);
    act(() => { fireEvent.change(n.tray.getByLabelText("How many?"), { target: { value: "3" } }); });
    expect(n.send().disabled).toBe(false);
  });

  it("money rounds to cents", () => {
    const m = mount("question: Budget?\nkind: money");
    act(() => { fireEvent.change(m.tray.getByLabelText("Budget?"), { target: { value: "1,200.456" } }); });
    act(() => { fireEvent.click(m.send()); });
    expect(m.answers()[0]).toEqual({ kind: "number", value: 1200.46 });
  });

  it("a default counts as the answer", () => {
    const m = mount("question: Count?\nkind: number\ndefault: 4");
    act(() => { fireEvent.click(m.send()); });
    expect(m.answers()[0]).toEqual({ kind: "number", value: 4 });
  });

  it("slider starts at its default", () => {
    const s = mount("question: Volume?\nkind: slider\nmin: 0\nmax: 10\ndefault: 7\nunit: dB");
    expect(s.tray.getByText("7 dB")).toBeTruthy();
    act(() => { fireEvent.click(s.send()); });
    expect(s.answers()[0]).toEqual({ kind: "number", value: 7 });
  });

  it("date", () => {
    const d = mount("question: When?\nkind: date");
    act(() => { fireEvent.change(d.tray.getByLabelText("When?"), { target: { value: "2026-10-27" } }); });
    act(() => { fireEvent.click(d.send()); });
    expect(d.answers()[0]).toEqual({ kind: "date", value: "2026-10-27" });
  });

  it("dropdown", () => {
    const d = mount("question: Region?\nkind: dropdown\noptions: [us-east, eu-west]");
    act(() => { fireEvent.change(d.tray.getByLabelText("Region?"), { target: { value: "eu-west" } }); });
    act(() => { fireEvent.click(d.send()); });
    expect(d.answers()[0]).toMatchObject({ kind: "options", picked: [{ value: "eu-west" }] });
  });

  it("split must add up to the total", () => {
    const s = mount("question: Split?\nkind: split\ntotal: 10\nitems: [x, y]");
    act(() => { fireEvent.change(s.tray.getByLabelText("x"), { target: { value: "6" } }); });
    expect(s.tray.getByText("4 left to place of 10")).toBeTruthy();
    expect(s.send().disabled).toBe(true);
    act(() => { fireEvent.change(s.tray.getByLabelText("y"), { target: { value: "4" } }); });
    expect(s.tray.getByText("Adds up to 10")).toBeTruthy();
    act(() => { fireEvent.click(s.send()); });
    const a = s.answers()[0];
    expect(a.kind === "split" && a.parts.map((p) => p.amount)).toEqual([6, 4]);
  });

  it("week of time slots: days across, times down", () => {
    const w = mount(`question: When can you talk?
kind: pick-several
options:
  - time: 2026-10-27T09:00
  - time: 2026-10-27T14:00
  - time: 2026-10-28T14:00
`);
    expect(w.tray.getByText("Tue")).toBeTruthy();
    expect(w.tray.getByText("Wed")).toBeTruthy();
    const slots = w.tray.getAllByRole("button", { pressed: false }).filter((b) => b.className.includes("week-slot"));
    expect(slots).toHaveLength(3);
    act(() => { fireEvent.click(slots[2]); });
    act(() => { fireEvent.click(w.send()); });
    expect(w.answers()[0]).toMatchObject({ kind: "options", picked: [{ value: "2026-10-28T14:00" }] });
  });

  it("colour, picture and file faces", () => {
    const onOpenFile = vi.fn();
    const f = mount(
      `question: Pick a look
layout: grid
options:
  - { label: Teal, color: "#11aaaa" }
  - { label: Shot, image: /home/u/shot.png }
  - { label: Spec, file: /home/u/spec.pdf }
  - { label: Elsewhere, image: "https://evil.example/x.png" }
`,
      { onOpenFile },
    );
    expect(f.tray.getByRole("radio", { name: /Teal/ }).querySelector(".pv-ask-swatch")).not.toBeNull();
    const img = f.tray.getByRole("radio", { name: /Shot/ }).querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`${window.location.origin}/file/box/home/u/shot.png`);
    // Pictures from other sites never load.
    expect(f.tray.getByRole("radio", { name: /Elsewhere/ }).querySelector("img")).toBeNull();
    act(() => { fireEvent.click(f.tray.getByRole("button", { name: "Open" })); });
    expect(onOpenFile).toHaveBeenCalledWith(`${window.location.origin}/file/box/home/u/spec.pdf`, "spec.pdf");
  });

  it("disabled while the agent restarts", () => {
    const d = mount("question: Ship?\noptions: [a, b]", { disabled: true });
    act(() => { fireEvent.click(d.tray.getByRole("radio", { name: /a/ })); });
    expect(d.onAnswer).not.toHaveBeenCalled();
  });
});

describe("AskTray — review fixes", () => {
  it("text and date defaults start filled in", () => {
    const t = mount("question: Draft it\nkind: long-text\ndefault: Dear team,");
    expect((t.tray.getByLabelText("Draft it") as HTMLTextAreaElement).value).toBe("Dear team,");
    expect(t.send().disabled).toBe(false);
  });

  it("a number default counts even on a tab never opened", () => {
    const t = mount("questions:\n  - question: Name?\n    kind: text\n  - question: Count?\n    kind: number\n    default: 3");
    act(() => { fireEvent.change(t.tray.getByLabelText("Name?"), { target: { value: "x" } }); });
    expect(t.send().disabled).toBe(false);
  });

  it("split takes decimals as typed and refuses negatives", () => {
    const s = mount("question: Split?\nkind: split\ntotal: 1\nitems: [x, y]");
    act(() => { fireEvent.change(s.tray.getByLabelText("x"), { target: { value: "0." } }); });
    expect((s.tray.getByLabelText("x") as HTMLInputElement).value).toBe("0.");
    act(() => { fireEvent.change(s.tray.getByLabelText("x"), { target: { value: "0.7" } }); });
    act(() => { fireEvent.change(s.tray.getByLabelText("y"), { target: { value: "0.3" } }); });
    expect(s.tray.getByText("Adds up to 1")).toBeTruthy();
    expect(s.send().disabled).toBe(false);
    act(() => { fireEvent.change(s.tray.getByLabelText("y"), { target: { value: "-0.3" } }); });
    expect(s.send().disabled).toBe(true);
  });
});
