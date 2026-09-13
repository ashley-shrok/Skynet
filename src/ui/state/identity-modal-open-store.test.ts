import { afterEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  __resetIdentityModalOpenStoreForTests,
  popIdentityModalOpen,
  pushIdentityModalOpen,
  useAnyIdentityModalOpen,
} from "./identity-modal-open-store";

describe("identity-modal-open-store", () => {
  afterEach(() => {
    __resetIdentityModalOpenStoreForTests();
  });

  it("returns false when no modal is open", () => {
    const { result } = renderHook(() => useAnyIdentityModalOpen());
    expect(result.current).toBe(false);
  });

  it("returns true after push", () => {
    const { result } = renderHook(() => useAnyIdentityModalOpen());
    act(() => pushIdentityModalOpen());
    expect(result.current).toBe(true);
  });

  it("returns false again after balanced pop", () => {
    const { result } = renderHook(() => useAnyIdentityModalOpen());
    act(() => pushIdentityModalOpen());
    act(() => popIdentityModalOpen());
    expect(result.current).toBe(false);
  });

  it("stays true while a second modal is open (counter, not boolean)", () => {
    const { result } = renderHook(() => useAnyIdentityModalOpen());
    act(() => pushIdentityModalOpen());
    act(() => pushIdentityModalOpen());
    act(() => popIdentityModalOpen());
    expect(result.current).toBe(true);
    act(() => popIdentityModalOpen());
    expect(result.current).toBe(false);
  });

  it("clamps at zero on unmatched pop", () => {
    const { result } = renderHook(() => useAnyIdentityModalOpen());
    act(() => popIdentityModalOpen());
    expect(result.current).toBe(false);
    act(() => pushIdentityModalOpen());
    expect(result.current).toBe(true);
  });
});
