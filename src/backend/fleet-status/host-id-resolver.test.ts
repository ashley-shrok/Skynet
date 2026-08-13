/**
 * Task 1 — Host ID resolver tests (TDD RED phase)
 *
 * Test 7: resolveHostRecordByName returns host record with matching name,
 *   null when no match; comparison is case-insensitive.
 *
 * Uses vi.mock to stub the database layer so no real DB is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database and drizzle-orm imports
vi.mock("../database/db/index.js", () => ({
  getDb: vi.fn(),
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../database/db/schema.js", () => ({
  hosts: { name: "name", id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join("?"),
    values,
  })),
}));

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { resolveHostRecordByName } from "./host-id-resolver.js";
import { getDb } from "../database/db/index.js";

describe("host-id-resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 7: resolveHostRecordByName returns host record by name (case-insensitive) and null when no match", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(),
    };

    const hostRow = { id: "host-42", name: "thenasty" };

    // First call: 'thenasty' matches
    mockDb.limit.mockResolvedValueOnce([hostRow]);
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const result = await resolveHostRecordByName("THENASTY");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("host-42");
    expect(result?.name).toBe("thenasty");

    // Second call: no match
    mockDb.limit.mockResolvedValueOnce([]);
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const noMatch = await resolveHostRecordByName("nonexistent");
    expect(noMatch).toBeNull();
  });
});
