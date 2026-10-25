import { describe, it, expect } from "vitest";
import { chartSpeech, parseChartBlock } from "./chart-spec";
import { diagramSpeech, mathSpeech, richSpeakable, splitFences, tableSpeech } from "./rich-speech";
import { cellNumber, sortOrder, tableFilename, toCsv, toTsv } from "./RichTable";
import { withDefaults } from "./RichChart";
import { themedSource } from "./RichDiagram";

describe("chart blocks", () => {
  const pie = '{"title":{"text":"Disk use by folder"},"series":[{"type":"pie","data":[{"name":"logs","value":4},{"name":"cache","value":6}]}]}';

  it("reads the standard option as JSON", () => {
    const res = parseChartBlock(pie);
    expect(res.ok).toBe(true);
  });

  it("also reads the loose form agents write (unquoted keys, single quotes, trailing commas)", () => {
    const res = parseChartBlock("{title: {text: 'Trend'}, xAxis: {type: 'category', data: ['a','b',]}, yAxis: {}, series: [{type: 'line', data: [1,2]},],}");
    expect(res.ok).toBe(true);
    if (res.ok) expect(chartSpeech(res.option)).toBe("A line chart: Trend.");
  });

  it("reads the code-style form with no space after the colon", () => {
    const res = parseChartBlock("{xAxis:{type:'category', data:['Mon','Tue']}, yAxis:{type:'value'}, series:[{name:'t1000',type:'line',data:[3.1,2.8]}]}");
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.option.series as { type: string }[])[0].type).toBe("line");
  });

  it("refuses an unreadable or seriesless block", () => {
    expect(parseChartBlock("{not json: [").ok).toBe(false);
    expect(parseChartBlock('{"title":{"text":"x"}}').ok).toBe(false);
    expect(parseChartBlock("[1,2]").ok).toBe(false);
    expect(parseChartBlock("").ok).toBe(false);
  });

  it("strips markup formatters, outside pictures and page-escaping settings", () => {
    const res = parseChartBlock(JSON.stringify({
      tooltip: { formatter: "<img src=x onerror=alert(1)>", extraCssText: "x", appendTo: "body", renderMode: "html" },
      graphic: [{ type: "image", style: { image: "https://evil.example/t.png" } }, { type: "text", style: { text: "ok" } }],
      series: [{ type: "scatter", symbol: "image://https://evil.example/p.png", label: { formatter: "{b}: {c}" }, data: [[1, 2]] }],
    }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const o = res.option as Record<string, any>;
    expect(o.tooltip).toEqual({ extraCssText: "x" });
    expect(o.graphic).toHaveLength(1);
    expect(o.series[0].symbol).toBeUndefined();
    expect(o.series[0].label.formatter).toBe("{b}: {c}");
  });

  it("speaks its kind and title", () => {
    const res = parseChartBlock(pie);
    if (res.ok) expect(chartSpeech(res.option)).toBe("A pie chart: Disk use by folder.");
    const bare = parseChartBlock('{"series":[{"type":"bar","data":[1]},{"type":"line","data":[2]}]}');
    if (bare.ok) expect(chartSpeech(bare.option)).toBe("A chart.");
  });

  it("adds hover values and a legend only when the agent didn't set them", () => {
    const res = parseChartBlock(pie);
    if (!res.ok) throw new Error("parse");
    const o = withDefaults(res.option) as Record<string, any>;
    expect(o.tooltip.trigger).toBe("item");
    expect(o.legend).toBeTruthy();
    const own = withDefaults({ ...res.option, tooltip: { show: false }, legend: { show: false } }) as Record<string, any>;
    expect(own.tooltip.show).toBe(false);
    expect(own.legend).toEqual({ show: false });
    const line = withDefaults({ xAxis: {}, yAxis: {}, series: [{ type: "line", data: [1] }] }) as Record<string, any>;
    expect(line.tooltip.trigger).toBe("axis");
    expect(line.legend).toBeUndefined();
  });
});

describe("diagram spoken lines and look", () => {
  it("names the kind and title", () => {
    expect(diagramSpeech("mermaid", "flowchart TD\n  A-->B")).toBe("A flowchart.");
    expect(diagramSpeech("mermaid", "%% note\ntimeline\n  title Release history\n  2024 : v1")).toBe("A timeline: Release history.");
    expect(diagramSpeech("mermaid", "gantt\n  title Deploy plan\n  section A")).toBe("A schedule chart: Deploy plan.");
    expect(diagramSpeech("mermaid", "pie title Pets\n  \"Dogs\" : 3")).toBe("A pie chart: Pets.");
    expect(diagramSpeech("mermaid", "---\ntitle: Deploy steps\n---\nflowchart LR\n A-->B")).toBe("A flowchart: Deploy steps.");
    expect(diagramSpeech("dot", 'digraph { label="Services"; a -> b }')).toBe("A graph diagram: Services.");
  });

  it("draws dark unless the diagram picks its own theme", () => {
    expect(themedSource("mermaid", "graph TD\nA-->B")).toMatch(/^%%\{init: \{"theme": "dark"/);
    expect(themedSource("mermaid", "%%{init: {'theme':'forest'}}%%\ngraph TD")).toBe("%%{init: {'theme':'forest'}}%%\ngraph TD");
    expect(themedSource("graphviz", "digraph G { a -> b }")).toMatch(/^digraph G \{ graph \[bgcolor="transparent"/);
  });
});

describe("table helpers", () => {
  it("reads numbers the way people write them", () => {
    expect(cellNumber("1,204")).toBe(1204);
    expect(cellNumber("$5.50")).toBe(5.5);
    expect(cellNumber("12%")).toBe(12);
    expect(cellNumber("3.2 GB")).toBe(3.2);
    expect(cellNumber("-4")).toBe(-4);
    expect(cellNumber("(7)")).toBe(-7);
    expect(cellNumber("v1.2.3")).toBeNull();
    expect(cellNumber("t1000")).toBeNull();
  });

  it("sorts numerically or by text, keeps empties last, and is stable", () => {
    const rows = [["b", "10"], ["a", "9"], ["c", ""], ["d", "100"]];
    expect(sortOrder(rows, 1, "asc")).toEqual([1, 0, 3, 2]);
    expect(sortOrder(rows, 1, "desc")).toEqual([3, 0, 1, 2]);
    expect(sortOrder(rows, 0, "asc")).toEqual([1, 0, 2, 3]);
    expect(sortOrder([["host2"], ["host10"], ["host1"]], 0, "asc")).toEqual([2, 0, 1]);
  });

  it("writes spreadsheet text, quoting where needed", () => {
    expect(toTsv(["a", "b"], [["1", "x\ty"]])).toBe("a\tb\n1\tx y");
    expect(toCsv(["name", "note"], [["a", 'say "hi", ok']])).toBe('name,note\r\na,"say ""hi"", ok"');
    expect(tableFilename(["Host name", "Disk"])).toBe("host-name.csv");
    expect(tableFilename(["", "x"])).toBe("table.csv");
  });

  it("speaks its size and headings", () => {
    expect(tableSpeech(["host", "disk"], 12)).toBe("A table of 12 rows: host, disk.");
    expect(tableSpeech(["x"], 1)).toBe("A table of 1 row: x.");
  });
});

describe("formula spoken lines", () => {
  it("reads short formulas and names long ones", () => {
    expect(mathSpeech("E = mc^2")).toBe("E equals mc squared");
    expect(mathSpeech("\\frac{a}{b}")).toBe("a over b");
    expect(mathSpeech("\\sum_{i=0}^{n} \\binom{n}{i} x^i y^{n-i} \\mathrm{d}x")).toBe("a formula");
  });
});

describe("voice mode reads wealthy text as its spoken lines", () => {
  it("replaces charts, diagrams, tables, collapsed sections and formulas", () => {
    const md = [
      "Here's the picture.",
      "",
      "```chart",
      '{"title":{"text":"Disk"},"series":[{"type":"pie","data":[1]}]}',
      "```",
      "",
      "| host | disk |",
      "| --- | --- |",
      "| a | 1 |",
      "| b | 2 |",
      "",
      "```mermaid",
      "flowchart TD",
      "A-->B",
      "```",
      "",
      "<details>",
      "<summary>Full logs</summary>",
      "",
      "lots of noisy lines",
      "",
      "</details>",
      "",
      "So $x^2$ costs $5 to $10.",
      "",
      "```bash",
      "ls",
      "```",
    ].join("\n");
    const out = richSpeakable(md);
    expect(out).toContain("A pie chart: Disk.");
    expect(out).toContain("A table of 2 rows: host, disk.");
    expect(out).toContain("A flowchart.");
    expect(out).toContain("Full logs.");
    expect(out).not.toContain("noisy");
    expect(out).toContain("So x squared costs $5 to $10.");
    expect(out).toContain("```bash\nls\n```");
  });

  it("leaves examples inside other code blocks alone", () => {
    const md = "````md\n```chart\n{}\n```\n| a | b |\n| - | - |\n````";
    const segs = splitFences(md);
    expect(segs).toHaveLength(1);
    expect(richSpeakable(md)).toBe(md);
  });
});
