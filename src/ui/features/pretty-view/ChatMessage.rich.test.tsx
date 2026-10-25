/**
 * Wealthy text in an agent bubble (shape-wealthy-text): workable tables,
 * charts, diagrams, collapsible sections and formulas — and a user's own
 * message keeps the plain rendering.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";

vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(),
  postSpeak: vi.fn(),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));
vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(() => ({ play: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn() })),
}));

const chart = { setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn(), dispatchAction: vi.fn() };
const init = vi.fn(() => chart);
vi.mock("echarts", () => ({ init: (...a: unknown[]) => init(...(a as [])), registerTheme: vi.fn() }));

const renderDiagram = vi.fn(async (_kind: string, source: string) => {
  if (source.includes("BROKEN")) throw new Error("Parse error on line 2");
  return { svg: "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='40'></svg>", width: 120, height: 40 };
});
vi.mock("./file-viewers/diagram/diagram-render", () => ({ renderDiagram: (k: string, s: string) => renderDiagram(k, s) }));

beforeEach(() => {
  init.mockClear();
  chart.setOption.mockReset();
  renderDiagram.mockClear();
});
afterEach(cleanup);

const agent = (content: string) => render(<ChatMessage role="assistant" eventId="e1" content={content} onOpenEditor={vi.fn()} />);

const TABLE = ["| host | disk |", "| --- | --- |", "| b | 10 |", "| a | 9 |", "| c | 100 |"].join("\n");
const bodyColumn = (col: number) => [...document.querySelectorAll("tbody tr")].map((tr) => tr.children[col].textContent);

describe("tables", () => {
  it("sorts by a heading: low→high, high→low, back to the agent's order", () => {
    agent(TABLE);
    const disk = screen.getByRole("columnheader", { name: /disk/ });
    expect(bodyColumn(1)).toEqual(["10", "9", "100"]);
    fireEvent.click(disk);
    expect(bodyColumn(1)).toEqual(["9", "10", "100"]);
    expect(disk.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(disk);
    expect(bodyColumn(1)).toEqual(["100", "10", "9"]);
    fireEvent.click(disk);
    expect(bodyColumn(1)).toEqual(["10", "9", "100"]);
    fireEvent.keyDown(screen.getByRole("columnheader", { name: /host/ }), { key: "Enter" });
    expect(bodyColumn(0)).toEqual(["a", "b", "c"]);
  });

  it("folds a long table behind 'show all' and unfolds it", () => {
    const rows = Array.from({ length: 14 }, (_, i) => `| r${i} | ${i} |`);
    agent(["| name | n |", "| - | - |", ...rows].join("\n"));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(10);
    fireEvent.click(screen.getByTestId("rich-table-fold"));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(14);
    expect(screen.getByTestId("rich-table-fold").textContent).toBe("Show fewer");
  });

  it("a short table gets no fold control", () => {
    agent(TABLE);
    expect(screen.queryByTestId("rich-table-fold")).toBeNull();
  });

  it("copies every row in the order on screen, for a spreadsheet", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const rows = Array.from({ length: 12 }, (_, i) => `| r${i} | ${12 - i} |`);
    agent(["| name | n |", "| - | - |", ...rows].join("\n"));
    fireEvent.click(screen.getByRole("columnheader", { name: /^n$/ }));
    fireEvent.click(screen.getByTestId("rich-table-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const tsv = (writeText.mock.calls[0] as unknown as [string])[0];
    const lines = tsv.split("\n");
    expect(lines).toHaveLength(13);
    expect(lines[0]).toBe("name\tn");
    expect(lines[1]).toBe("r11\t1");
  });

  it("speaks as its size and headings, not every cell", () => {
    agent(TABLE);
    const sr = within(screen.getByTestId("rich-table")).getByText("A table of 3 rows: host, disk.");
    expect(sr.className).toContain("sr-only");
  });

  it("a user's own pasted table stays plain", () => {
    render(<ChatMessage role="user" content={TABLE} />);
    expect(screen.queryByTestId("rich-table")).toBeNull();
    expect(document.querySelector("table")).not.toBeNull();
  });
});

describe("charts", () => {
  it("draws a chart block with the app look and the agent's option", async () => {
    agent('Here:\n\n```chart\n{"title":{"text":"Disk"},"series":[{"type":"pie","data":[{"name":"a","value":1}]}]}\n```\n');
    expect(screen.getByTestId("rich-chart")).toBeTruthy();
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect((init.mock.calls[0] as unknown[])[1]).toBe("skynet");
    const opt = chart.setOption.mock.calls[0][0];
    expect(opt.series[0].type).toBe("pie");
    expect(opt.tooltip.trigger).toBe("item");
    expect(screen.getByText("A pie chart: Disk.").className).toContain("sr-only");
    expect(document.querySelector("pre")).toBeNull();
  });

  it("a broken chart shows its source under a quiet note", () => {
    agent("```chart\n{oops: [\n```");
    expect(screen.getByTestId("rich-fallback").textContent).toContain("Couldn't draw this chart.");
    expect(document.querySelector("pre code")?.textContent).toBe("{oops: [");
  });

  it("a chart the library rejects falls back the same way", async () => {
    chart.setOption.mockImplementationOnce(() => {
      throw new Error("Unknown series wat");
    });
    agent('```chart\n{"series":[{"type":"wat","data":[1]}]}\n```');
    await waitFor(() => expect(screen.getByTestId("rich-fallback")).toBeTruthy());
    expect(chart.dispose).toHaveBeenCalled();
  });

  it("an example chart inside another code block stays an example", () => {
    agent('````md\n```chart\n{"series":[{"type":"pie","data":[1]}]}\n```\n````');
    expect(screen.queryByTestId("rich-chart")).toBeNull();
  });
});

describe("diagrams", () => {
  it("draws diagram source as a picture, dark, with a source toggle", async () => {
    agent("```mermaid\ntimeline\n  title Releases\n  2024 : v1\n```");
    await waitFor(() => expect(document.querySelector(".pv-rich-diagram-img")).not.toBeNull());
    expect(renderDiagram.mock.calls[0][0]).toBe("mermaid");
    expect(renderDiagram.mock.calls[0][1]).toMatch(/"theme": "dark"/);
    expect(screen.getByText("A timeline: Releases.").className).toContain("sr-only");
    fireEvent.click(screen.getByRole("button", { name: /Source/ }));
    expect(document.querySelector("pre code")?.textContent).toContain("timeline");
  });

  it("graphviz source draws too", async () => {
    agent("```dot\ndigraph { a -> b }\n```");
    await waitFor(() => expect(renderDiagram).toHaveBeenCalledWith("graphviz", expect.stringContaining("a -> b")));
  });

  it("a diagram that won't parse shows its source", async () => {
    agent("```mermaid\nflowchart TD\nBROKEN -->\n```");
    await waitFor(() => expect(screen.getByTestId("rich-fallback").textContent).toContain("Couldn't draw this diagram."));
  });
});

describe("collapsible sections", () => {
  it("the standard markup becomes an open/close section with markdown inside", () => {
    agent("The answer is 4.\n\n<details>\n<summary>How I got there</summary>\n\nStep **one**.\n\n</details>\n");
    const details = document.querySelector("details")!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("How I got there");
    expect(details.querySelector("strong")?.textContent).toBe("one");
  });

  it("honours open, and a squeezed one-line section", () => {
    agent("<details open><summary>Logs</summary>line one</details>");
    const details = document.querySelector("details")!;
    expect(details.open).toBe(true);
    expect(details.textContent).toContain("line one");
  });

  it("no other web markup is let in", () => {
    const { container } = agent("Some <b>bold</b> and <img src=x onerror=alert(1)> here.");
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<b>bold</b>");
  });
});

describe("math", () => {
  it("draws formulas in the strict form and leaves prices alone", async () => {
    agent("Energy is $E = mc^2$, and it costs $5 to $10 or between $5-$10.\n\n$$\n\\frac{a}{b}\n$$");
    await waitFor(() => expect(screen.getAllByTestId("rich-math")).toHaveLength(2));
    const text = document.body.textContent ?? "";
    expect(text).toContain("costs $5 to $10 or between $5-$10.");
    expect(document.querySelector(".katex")).not.toBeNull();
    expect(screen.getByText("E equals mc squared").className).toContain("sr-only");
  });

  it("a formula with an error shows its source", async () => {
    agent("Try $\\frac{a$ now.");
    await waitFor(() => expect(screen.getByTestId("rich-math-source").textContent).toBe("$\\frac{a$"));
  });
});
