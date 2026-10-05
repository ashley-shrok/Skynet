import { describe, it, expect } from "vitest";
import {
  changeCellType,
  firstImageOutput,
  newCell,
  notebookTitle,
  parseNotebook,
  serializeNotebook,
  splitLines,
  withSource,
} from "./nb-model";

// What Jupyter writes: indent 1, sorted keys, trailing newline, non-ASCII as-is.
const jupyterText =
  JSON.stringify(
    {
      cells: [
        { cell_type: "markdown", id: "a1", metadata: {}, source: ["# Héllo — notebook\n", "Some $x^2$ maths"] },
        {
          cell_type: "code",
          execution_count: 3,
          id: "b2",
          metadata: { tags: ["x"] },
          outputs: [
            { name: "stdout", output_type: "stream", text: ["hi\n"] },
            { data: { "image/png": "iVBORw0KGgo=\n", "text/plain": ["<Figure>"] }, metadata: {}, output_type: "display_data" },
          ],
          source: ["print('hi')\n", "plot()"],
        },
      ],
      metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  ) + "\n";

describe("nb-model", () => {
  it("round-trips a Jupyter-written notebook byte for byte", () => {
    const doc = parseNotebook(jupyterText);
    expect(doc.indent).toBe(1);
    expect(serializeNotebook(doc)).toBe(jupyterText);
  });

  it("keeps a 2-space indent and missing trailing newline", () => {
    const text = JSON.stringify(JSON.parse(jupyterText), null, 2);
    expect(serializeNotebook(parseNotebook(text))).toBe(text);
  });

  it("edits only the cell's source, keeping its line-list shape", () => {
    const doc = parseNotebook(jupyterText);
    const edited = withSource(doc.nb.cells[1], "print('bye')\nplot()\n");
    expect(edited.source).toEqual(["print('bye')\n", "plot()\n"]);
    expect(edited.outputs).toBe(doc.nb.cells[1].outputs);
    expect(withSource({ cell_type: "markdown", source: "x" }, "y\nz").source).toBe("y\nz");
    expect(splitLines("")).toEqual([]);
  });

  it("makes new cells and switches types like Jupyter", () => {
    const { nb } = parseNotebook(jupyterText);
    const code = newCell("code", nb);
    expect(Object.keys(code)).toEqual(["cell_type", "execution_count", "id", "metadata", "outputs", "source"]);
    expect(code.id).toMatch(/^[0-9a-f]{8}$/);
    const md = changeCellType(nb.cells[1], "markdown");
    expect(md).not.toHaveProperty("outputs");
    expect(md).not.toHaveProperty("execution_count");
    expect(md.source).toEqual(nb.cells[1].source);
    const back = changeCellType(md, "code");
    expect(back.outputs).toEqual([]);
    expect(back.execution_count).toBeNull();
    // Older 4.x notebooks have no cell ids.
    expect(newCell("markdown", { ...nb, nbformat_minor: 4 })).not.toHaveProperty("id");
  });

  it("finds a title and the first plot", () => {
    const { nb } = parseNotebook(jupyterText);
    expect(notebookTitle(nb)).toBe("Héllo — notebook");
    expect(firstImageOutput(nb)).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("explains files it can't open", () => {
    expect(() => parseNotebook("{nope")).toThrow(/valid notebook JSON/);
    expect(() => parseNotebook('{"nbformat": 3, "worksheets": []}')).toThrow(/old format/);
    expect(() => parseNotebook('{"hello": 1}')).toThrow(/isn't a Jupyter notebook/);
  });
});

describe("display maths", () => {
  it("splits one-line $$…$$ into a display block", async () => {
    const { normaliseDisplayMath } = await import("./NbMarkdown");
    expect(normaliseDisplayMath("a\n$$x^2$$\nb")).toBe("a\n$$\nx^2\n$$\nb");
    expect(normaliseDisplayMath("inline $x$ and $$y$$ mid-line")).toBe("inline $x$ and $$y$$ mid-line");
  });
});
