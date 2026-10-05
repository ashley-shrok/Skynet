import { colorSchemeDark, themeQuartz } from "ag-grid-community";

/** Dark AG Grid theme shared by the CSV editor and the data viewers. */
export const DARK_GRID_THEME = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#13151c",
  foregroundColor: "#e8e4d8",
  headerBackgroundColor: "#1b1e27",
  headerTextColor: "#e8e4d8",
  oddRowBackgroundColor: "#161922",
  borderColor: "rgba(255,255,255,0.10)",
  accentColor: "hsl(220, 80%, 65%)",
  fontSize: 12,
  headerFontSize: 12,
  spacing: 5,
  wrapperBorderRadius: 8,
});
