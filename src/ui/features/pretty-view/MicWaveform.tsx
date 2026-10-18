// Live mic waveform — a short scrolling bar trace of the dictation mic's input
// level, shown in the recording pill so a dead mic (a flat line) is obvious
// while the user is still talking.
//
// Samples `read()` (windowed RMS 0–1, from mic-level-monitor) every
// SAMPLE_MS on an animation frame and draws the last BAR_COUNT samples onto a
// canvas, newest on the right. Stays hidden until `read()` returns something
// other than null or an exact 0: an analyser that never receives the stream
// (iPhone Safari) reads pure zeros while the recording itself is fine, and a
// flat line there would cry wolf. A real dead mic still shows — its feed
// carries a non-zero blip as it opens, then flatlines.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SAMPLE_MS = 50;
const BAR_COUNT = 32;
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const HEIGHT = 18;
const WIDTH = BAR_COUNT * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
/** dBFS mapped to an empty bar / a full bar. Speech sits around −35 to −15. */
const FLOOR_DB = -60;
const CEIL_DB = -15;
const MIN_BAR_PX = 1.5;

/** RMS (0–1) → bar fill 0–1 on a dB scale. */
export function levelToFill(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
}

export interface MicWaveformProps {
  read: () => number | null;
  className?: string;
}

export function MicWaveform({ read, className }: MicWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const fills: number[] = new Array(BAR_COUNT).fill(0);
    let seen = false;
    let last = 0;
    let raf = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      const g = canvas?.getContext("2d");
      if (!canvas || !g) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== WIDTH * dpr) {
        canvas.width = WIDTH * dpr;
        canvas.height = HEIGHT * dpr;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, WIDTH, HEIGHT);
      g.fillStyle = getComputedStyle(canvas).color;
      for (let i = 0; i < BAR_COUNT; i++) {
        const h = Math.max(MIN_BAR_PX, fills[i] * HEIGHT);
        g.fillRect(i * (BAR_WIDTH + BAR_GAP), (HEIGHT - h) / 2, BAR_WIDTH, h);
      }
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < SAMPLE_MS) return;
      last = now;
      const rms = readRef.current();
      if (rms === null) return;
      if (!seen) {
        if (rms === 0) return;
        seen = true;
        setVisible(true);
      }
      fills.shift();
      fills.push(levelToFill(rms));
      draw();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="mic-waveform"
      aria-hidden="true"
      style={{ width: WIDTH, height: HEIGHT }}
      className={cn(visible ? "block" : "hidden", className)}
    />
  );
}
