import { useEffect, useMemo, useRef, useState } from "react";
import { SPEAK_SKIP_ATTR } from "../speakable-text";
import { chartSpeech, parseChartBlock, type ChartOption } from "./chart-spec";
import { RichFallback } from "./RichFallback";
import { useInView } from "./use-in-view";

// A ```chart block drawn as a chart (shape-wealthy-text). The chart library
// loads on first use and each chart draws only once it scrolls near the
// screen. The app's look is a registered theme; any colours the agent sets in
// its option win over it. Hover (tap on a phone) shows values; the legend
// hides and shows series.

type ECharts = typeof import("echarts");
type ChartInstance = ReturnType<ECharts["init"]>;

const THEME = "skynet";
// Categorical palette stepped for a dark surface (validated set).
const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const INK = "#f1ede4";
const INK_2 = "#c3c2b7";
const MUTED = "#9a978e";
const GRID = "rgba(255,255,255,0.08)";
const AXIS = "rgba(255,255,255,0.22)";
const PANEL = "#121317";

let echartsReady: Promise<ECharts> | null = null;
function loadECharts(): Promise<ECharts> {
  echartsReady ??= import("echarts").then((echarts) => {
    const axis = {
      axisLine: { lineStyle: { color: AXIS } },
      axisTick: { lineStyle: { color: AXIS } },
      axisLabel: { color: MUTED },
      splitLine: { lineStyle: { color: GRID } },
      nameTextStyle: { color: MUTED },
    };
    echarts.registerTheme(THEME, {
      color: PALETTE,
      backgroundColor: "transparent",
      textStyle: { color: INK_2, fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif" },
      title: { textStyle: { color: INK, fontSize: 14, fontWeight: 600 }, subtextStyle: { color: MUTED } },
      legend: { textStyle: { color: INK_2 }, inactiveColor: "#55534d", pageTextStyle: { color: MUTED }, pageIconColor: INK_2, pageIconInactiveColor: "#55534d" },
      tooltip: {
        backgroundColor: "#24262d",
        borderColor: "rgba(255,255,255,0.12)",
        textStyle: { color: INK },
        axisPointer: { lineStyle: { color: AXIS }, crossStyle: { color: AXIS } },
      },
      categoryAxis: axis,
      valueAxis: axis,
      timeAxis: axis,
      logAxis: axis,
      line: { lineStyle: { width: 2 }, symbolSize: 8 },
      bar: { itemStyle: { borderRadius: [4, 4, 0, 0] } },
      pie: {
        itemStyle: { borderColor: PANEL, borderWidth: 2 },
        label: { color: INK_2, textBorderWidth: 0 },
        labelLine: { lineStyle: { color: AXIS } },
      },
    });
    return echarts;
  });
  return echartsReady;
}

function seriesList(option: ChartOption): Record<string, unknown>[] {
  const s = option.series;
  return (Array.isArray(s) ? s : [s]).filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

/** Hover values and a legend when the agent didn't ask for them itself. */
export function withDefaults(option: ChartOption): ChartOption {
  const series = seriesList(option);
  const out: ChartOption = { ...option };
  const cartesian = "xAxis" in option || "yAxis" in option;
  if (out.tooltip === undefined) out.tooltip = { trigger: cartesian ? "axis" : "item", confine: true };
  else if (out.tooltip && typeof out.tooltip === "object" && !Array.isArray(out.tooltip)) out.tooltip = { confine: true, ...(out.tooltip as object) };
  // A titled pie sits a little lower so its labels clear the title.
  if (out.title !== undefined && series.some((s) => s.type === "pie" && s.center === undefined)) {
    out.series = (Array.isArray(option.series) ? option.series : [option.series]).map((s) =>
      s && typeof s === "object" && (s as Record<string, unknown>).type === "pie" && (s as Record<string, unknown>).center === undefined
        ? { ...(s as object), center: ["50%", "55%"] }
        : s,
    );
  }
  const namedSeries = series.filter((s) => typeof s.name === "string").length;
  const itemLegend = series.some((s) => s.type === "pie" || s.type === "funnel");
  if (out.legend === undefined && (namedSeries >= 2 || itemLegend)) out.legend = { type: "scroll", bottom: 0 };
  if (out.legend && out.grid === undefined && cartesian) out.grid = { left: 8, right: 16, top: out.title ? 44 : 16, bottom: 40, containLabel: true };
  else if (out.grid === undefined && cartesian) out.grid = { left: 8, right: 16, top: out.title ? 44 : 16, bottom: 8, containLabel: true };
  return out;
}

export function RichChart({ source }: { source: string }) {
  const parsed = useMemo(() => parseChartBlock(source), [source]);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(boxRef);
  const [drawError, setDrawError] = useState<string | null>(null);

  useEffect(() => {
    if (!parsed.ok || !inView || !boxRef.current) return;
    const el = boxRef.current;
    let chart: ChartInstance | null = null;
    let ro: ResizeObserver | null = null;
    let live = true;
    const onOutside = (e: PointerEvent) => {
      if (chart && !el.contains(e.target as Node)) chart.dispatchAction({ type: "hideTip" });
    };
    loadECharts()
      .then((echarts) => {
        if (!live) return;
        try {
          chart = echarts.init(el, THEME, { renderer: "canvas" });
          chart.setOption(withDefaults(parsed.option));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[rich-chart] draw failed error=${msg.slice(0, 160)}`);
          chart?.dispose();
          chart = null;
          setDrawError(msg);
          return;
        }
        if (typeof ResizeObserver !== "undefined") {
          ro = new ResizeObserver(() => chart?.resize());
          ro.observe(el);
        }
        // Phone: a tap elsewhere clears the value shown by the last tap.
        document.addEventListener("pointerdown", onOutside, true);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[rich-chart] chart library failed to load error=${msg}`);
        if (live) setDrawError(msg);
      });
    return () => {
      live = false;
      ro?.disconnect();
      document.removeEventListener("pointerdown", onOutside, true);
      chart?.dispose();
    };
  }, [parsed, inView]);

  if (!parsed.ok || drawError) {
    return <RichFallback what="chart" lang="chart" source={source} reason={parsed.ok ? drawError ?? undefined : parsed.error} />;
  }
  return (
    <div className="pv-rich-panel pv-rich-chart-wrap" data-testid="rich-chart">
      <div ref={boxRef} className="pv-rich-chart" aria-hidden="true" {...{ [SPEAK_SKIP_ATTR]: "" }} />
      <span className="sr-only">{chartSpeech(parsed.option)}</span>
    </div>
  );
}
