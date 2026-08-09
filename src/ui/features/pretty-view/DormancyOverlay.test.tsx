/**
 * quick 260808-cd6 + 260809 progress-bar refinement — DormancyOverlay unit tests.
 *
 * Seven tests covering:
 *   Test 1: waking=false, error=null → renders "This session is asleep" + Wake button enabled.
 *   Test 2: waking=false → Wake button click invokes onWake prop.
 *   Test 3: waking=true, elapsedSeconds=0 → renders "Waking up…" + NO Wake button.
 *   Test 4: waking=true → progressbar rendered; aria-valuenow scales with elapsedSeconds
 *           and caps at 95 (90s ETA * 0.95 cap).
 *   Test 5: waking=false OR error set → progressbar NOT rendered.
 *   Test 6: waking=false, error="rm failed" → warm-red error copy + Wake button (retry).
 *   Test 7: Moon glyph is STATIC — rendered SVG does NOT carry `animate-spin`
 *           in any variant (motion-channel guardrail regression guard).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DormancyOverlay } from "./DormancyOverlay";

// ─── Test 1 ───────────────────────────────────────────────────────────────────

describe('DormancyOverlay — asleep state (waking=false, no error)', () => {
  it('renders "This session is asleep" text and an enabled Wake button', () => {
    render(
      <DormancyOverlay waking={false} elapsedSeconds={0} onWake={vi.fn()} error={null} />,
    );
    expect(screen.getByText(/session is asleep/i)).toBeTruthy();
    const wakeBtn = screen.getByRole('button', { name: /wake identity/i }) as HTMLButtonElement;
    expect(wakeBtn).toBeTruthy();
    expect(wakeBtn.disabled).toBe(false);
  });
});

// ─── Test 2 ───────────────────────────────────────────────────────────────────

describe('DormancyOverlay — Wake button click', () => {
  it('Wake button click invokes the onWake prop exactly once', () => {
    const onWake = vi.fn();
    render(
      <DormancyOverlay waking={false} elapsedSeconds={0} onWake={onWake} />,
    );
    const wakeBtn = screen.getByRole('button', { name: /wake identity/i });
    fireEvent.click(wakeBtn);
    expect(onWake).toHaveBeenCalledTimes(1);
  });
});

// ─── Test 3 ───────────────────────────────────────────────────────────────────

describe('DormancyOverlay — waking state (waking=true, elapsedSeconds=0)', () => {
  it('renders "Waking up…" text and no Wake button', () => {
    render(
      <DormancyOverlay waking={true} elapsedSeconds={0} onWake={vi.fn()} />,
    );
    expect(screen.getByText(/waking up…/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /wake identity/i })).toBeNull();
  });
});

// ─── Test 4 ───────────────────────────────────────────────────────────────────

describe('DormancyOverlay — waking-state progress bar', () => {
  it('renders a progressbar whose aria-valuenow scales with elapsedSeconds and caps at 95', () => {
    // At elapsedSeconds=0 → 0
    const { rerender } = render(
      <DormancyOverlay waking={true} elapsedSeconds={0} onWake={vi.fn()} />,
    );
    let bar = screen.getByRole('progressbar', { name: /waking progress/i });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');

    // At elapsedSeconds=45 (half of 90s ETA) → 50
    rerender(
      <DormancyOverlay waking={true} elapsedSeconds={45} onWake={vi.fn()} />,
    );
    bar = screen.getByRole('progressbar', { name: /waking progress/i });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');

    // At elapsedSeconds=200 (well past 90s) → capped at 95
    rerender(
      <DormancyOverlay waking={true} elapsedSeconds={200} onWake={vi.fn()} />,
    );
    bar = screen.getByRole('progressbar', { name: /waking progress/i });
    expect(bar.getAttribute('aria-valuenow')).toBe('95');
  });
});

// ─── Test 5 ───────────────────────────────────────────────────────────────────

describe('DormancyOverlay — progress bar suppression', () => {
  it('does NOT render progressbar in asleep state (waking=false, with or without error)', () => {
    // asleep + no error — no bar
    const { rerender } = render(
      <DormancyOverlay waking={false} elapsedSeconds={0} onWake={vi.fn()} />,
    );
    expect(screen.queryByRole('progressbar', { name: /waking progress/i })).toBeNull();

    // asleep + error (Wake-failed retry state) — no bar
    rerender(
      <DormancyOverlay waking={false} elapsedSeconds={30} onWake={vi.fn()} error="rm failed" />,
    );
    expect(screen.queryByRole('progressbar', { name: /waking progress/i })).toBeNull();
  });
});

// ─── Test 6 ───────────────────────────────────────────────────────────────────

describe('DormancyOverlay — error variant (waking=false, error set)', () => {
  it('renders "Couldn\'t wake — rm failed" copy and an enabled Wake button for retry', () => {
    render(
      <DormancyOverlay waking={false} elapsedSeconds={0} onWake={vi.fn()} error="rm failed" />,
    );
    expect(screen.getByText(/couldn't wake — rm failed/i)).toBeTruthy();
    const wakeBtn = screen.getByRole('button', { name: /wake identity/i }) as HTMLButtonElement;
    expect(wakeBtn).toBeTruthy();
    expect(wakeBtn.disabled).toBe(false);
  });
});

// ─── Test 7 ───────────────────────────────────────────────────────────────────

describe('DormancyOverlay — motion-channel guardrail: Moon glyph is STATIC', () => {
  it('renders no element with class animate-spin in any variant (guardrail regression guard)', () => {
    // Check all three variants: asleep, waking, error
    const { container: c1, unmount: u1 } = render(
      <DormancyOverlay waking={false} elapsedSeconds={0} onWake={vi.fn()} />,
    );
    expect(c1.querySelector('.animate-spin')).toBeNull();
    u1();

    const { container: c2, unmount: u2 } = render(
      <DormancyOverlay waking={true} elapsedSeconds={20} onWake={vi.fn()} />,
    );
    expect(c2.querySelector('.animate-spin')).toBeNull();
    u2();

    const { container: c3 } = render(
      <DormancyOverlay waking={false} elapsedSeconds={0} onWake={vi.fn()} error="failed" />,
    );
    expect(c3.querySelector('.animate-spin')).toBeNull();
  });
});
