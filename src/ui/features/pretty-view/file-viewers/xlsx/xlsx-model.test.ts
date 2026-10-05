import { describe, it, expect, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { colName, parseWorkbook, type XWorkbook } from "./xlsx-model";

async function buildWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Budget", { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }] });
  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = "Title";
  ws.getCell("A1").font = { bold: true, color: { argb: "FFFF0000" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { theme: 4 } };
  ws.getCell("A2").value = new Date(Date.UTC(2026, 9, 1));
  ws.getCell("A2").numFmt = "d mmm yyyy";
  ws.getCell("B2").value = 1234.5;
  ws.getCell("B2").numFmt = '"$"#,##0.00';
  ws.getCell("C2").value = { formula: "B2*2", result: 2469 };
  ws.getCell("C2").border = { bottom: { style: "double", color: { argb: "FF00FF00" } } };
  ws.getCell("A3").value = { richText: [{ text: "rich " }, { text: "text" }] };
  ws.getCell("B3").value = true;
  ws.getColumn(1).width = 20;
  ws.getRow(3).height = 30;
  wb.addWorksheet("Hidden", { state: "hidden" });
  wb.addWorksheet("Second").getCell("A1").value = "two";
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  zip.file("xl/charts/chart1.xml", "<c:chartSpace/>");
  zip.file("xl/charts/chart2.xml", "<c:chartSpace/>");
  zip.file("xl/pivotTables/pivotTable1.xml", "<pivotTableDefinition/>");
  return (await zip.generateAsync({ type: "uint8array" })).buffer as ArrayBuffer;
}

let wb: XWorkbook;
beforeAll(async () => {
  wb = await parseWorkbook(ExcelJS, await buildWorkbook());
});

describe("parseWorkbook", () => {
  it("lists visible sheets only and counts charts / pivot tables", () => {
    expect(wb.sheets.map((s) => s.name)).toEqual(["Budget", "Second"]);
    expect(wb.charts).toBe(2);
    expect(wb.pivotTables).toBe(1);
  });

  it("formats values the way Excel displays them", () => {
    const s = wb.sheets[0];
    expect(s.rows[1]?.[0]?.text).toBe("1 Oct 2026");
    expect(s.rows[1]?.[1]?.text).toBe("$1,234.50");
    expect(s.rows[1]?.[2]).toMatchObject({ text: "2469", formula: "B2*2", numeric: true });
    expect(s.rows[2]?.[0]?.text).toBe("rich text");
    expect(s.rows[2]?.[1]?.text).toBe("TRUE");
  });

  it("maps styles to CSS, including theme colours and borders", () => {
    const title = wb.sheets[0].rows[0]?.[0]?.style;
    // ExcelJS writes the Office 2007 theme (accent1 4F81BD): read from the file, not the default.
    expect(title).toMatchObject({ fontWeight: 700, color: "#FF0000", backgroundColor: "#4F81BD" });
    expect(wb.sheets[0].rows[1]?.[2]?.style?.borderBottom).toBe("3px double #00FF00");
    // Numbers right-align by default, text left.
    expect(wb.sheets[0].rows[1]?.[1]?.style?.justifyContent).toBe("flex-end");
    expect(wb.sheets[0].rows[2]?.[0]?.style?.justifyContent).toBe("flex-start");
  });

  it("records merges, sizes and frozen panes; a freeze cutting a merge is dropped", () => {
    const s = wb.sheets[0];
    expect(s.merges).toEqual([{ top: 0, left: 0, bottom: 0, right: 2 }]);
    expect(s.rows[0]?.[1]).toBeUndefined(); // covered by the merge
    expect(s.colWidths[0]).toBe(145); // 20 chars
    expect(s.rowHeights[2]).toBe(40); // 30pt
    expect(s.frozenRows).toBe(2);
    expect(s.frozenCols).toBe(0); // xSplit=1 would cut A1:C1
    expect(s.colCount).toBeGreaterThan(3); // padded like Excel
  });

  it("stops early with maxRows (chip previews)", async () => {
    const small = await parseWorkbook(ExcelJS, await buildWorkbook(), { maxRows: 1, skipImages: true });
    expect(small.sheets[0].rows.length).toBe(1);
  });
});

describe("colName", () => {
  it.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [701, "ZZ"],
  ])("%i → %s", (i, name) => expect(colName(i)).toBe(name));
});
