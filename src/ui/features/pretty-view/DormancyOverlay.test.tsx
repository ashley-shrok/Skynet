/**
 * quick 260808-cd6 — DormancyOverlay unit tests.
 *
 * Seven tests covering:
 *   Test 1: waking=false, error=null → renders "This session is asleep" + Wake button enabled.
 *   Test 2: waking=false → Wake button click invokes onWake prop.
 *   Test 3: waking=true, elapsedSeconds=0 → renders "Waking up…" + NO Wake button.
 *   Test 4: waking=true, elapsedSeconds=14 → does NOT render elapsed-hint.
 *   Test 5: waking=true, elapsedSeconds=15 → DOES render "This can take up to a minute." hint.
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

describe('DormancyOverlay — waking state at 14s (no elapsed-hint yet)', () => {
  it('does NOT render the "This can take up to a minute." hint at elapsedSeconds=14', () => {
    render(
      <DormancyOverlay waking={true} elapsedSeconds={14} onWake={vi.fn()} />,
    );
    expect(screen.queryByText(/this can take up to a minute/i)).toBeNull();
  });
});

// ─── Test 5 ───────────────────────────────────────────────────────────────────

describe('DormancyOverlay — waking state at 15s (elapsed-hint appears)', () => {
  it('renders "This can take up to a minute." hint at elapsedSeconds=15', () => {
    render(
      <DormancyOverlay waking={true} elapsedSeconds={15} onWake={vi.fn()} />,
    );
    expect(screen.getByText(/this can take up to a minute/i)).toBeTruthy();
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
