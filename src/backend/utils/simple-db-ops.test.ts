/**
 * simple-db-ops.test.ts — Unit tests for SimpleDBOps.updateNonSensitive + insertNonSensitive
 *
 * Plan 260910-67z Task 1 (TDD RED → GREEN):
 *   5 tests for updateNonSensitive + 5 tests for insertNonSensitive = 10 total
 *
 * Mock strategy:
 *   - Mock ../database/db/index.js to expose getDb() returning update/insert builder stubs
 *   - Mock ./data-crypto.js to spy on DataCrypto.validateUserAccess (must NOT be called)
 *   - DatabaseSaveTrigger.triggerSave is exposed via the db/index.js mock
 *
 * Note: vi.mock factories are hoisted to top of file before variable declarations.
 *   All mock functions are created inside the factory, then imported via the mocked module
 *   for spy assertions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — factories are hoisted; define fns inside them
// ---------------------------------------------------------------------------

vi.mock("../database/db/index.js", () => {
  const mockReturning = vi.fn(() => Promise.resolve([{ id: 1, credentialId: 42, authType: "credential" }]));
  const mockWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn(() => ({ where: mockWhere }));
  const mockUpdateBuilder = vi.fn(() => ({ set: mockSet }));
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsertBuilder = vi.fn(() => ({ values: mockValues }));

  return {
    getDb: vi.fn(() => ({
      update: mockUpdateBuilder,
      insert: mockInsertBuilder,
    })),
    DatabaseSaveTrigger: {
      triggerSave: vi.fn(),
    },
  };
});

vi.mock("./data-crypto.js", () => ({
  DataCrypto: {
    validateUserAccess: vi.fn(),
    getUserDataKey: vi.fn(() => null),
    encryptRecord: vi.fn((_, data) => data),
    decryptRecord: vi.fn((_, data) => data),
    decryptRecords: vi.fn((_, data) => data),
    canUserAccessData: vi.fn(() => false),
  },
}));

// ---------------------------------------------------------------------------
// Import under test and mocked modules (for spy assertions)
// ---------------------------------------------------------------------------

import { SimpleDBOps } from "./simple-db-ops.js";
import { getDb, DatabaseSaveTrigger } from "../database/db/index.js";
import { DataCrypto } from "./data-crypto.js";

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Restore the returning chain to return a valid row after clearAllMocks wipes call history
  // We need to re-wire the chain because clearAllMocks resets mockImplementation too
  const mockReturning = vi.fn(() => Promise.resolve([{ id: 1, credentialId: 42, authType: "credential" }]));
  const mockWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn(() => ({ where: mockWhere }));
  const mockUpdateBuilder = vi.fn(() => ({ set: mockSet }));
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsertBuilder = vi.fn(() => ({ values: mockValues }));

  (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
    update: mockUpdateBuilder,
    insert: mockInsertBuilder,
  });
});

// ---------------------------------------------------------------------------
// updateNonSensitive tests
// ---------------------------------------------------------------------------

describe("SimpleDBOps.updateNonSensitive", () => {
  it("updateNonSensitive_writes_non_sensitive_fields: calls getDb().update chain with data and returns rows", async () => {
    const fakeTable = {} as Parameters<typeof SimpleDBOps.updateNonSensitive>[0];
    const fakeWhere = {};
    const data = { credentialId: 42, authType: "credential" };

    const result = await SimpleDBOps.updateNonSensitive(fakeTable, "ssh_data", fakeWhere, data);

    const db = getDb();
    expect(db.update).toHaveBeenCalledWith(fakeTable);
    expect(result).toEqual([{ id: 1, credentialId: 42, authType: "credential" }]);
  });

  it("updateNonSensitive_throws_on_sensitive_field_in_data: passing { password: 'x' } for ssh_data throws with field name in message and does NOT reach getDb().update", async () => {
    const fakeTable = {} as Parameters<typeof SimpleDBOps.updateNonSensitive>[0];
    const fakeWhere = {};
    const data = { password: "x" };

    await expect(
      SimpleDBOps.updateNonSensitive(fakeTable, "ssh_data", fakeWhere, data),
    ).rejects.toThrow("password");

    // Must NOT reach the DB — getDb() should not have been called
    expect(getDb).not.toHaveBeenCalled();
  });

  it("updateNonSensitive_throws_lists_all_sensitive_fields_for_credentials_table: passing { privateKey: 'y' } for ssh_credentials throws with privateKey in message", async () => {
    const fakeTable = {} as Parameters<typeof SimpleDBOps.updateNonSensitive>[0];
    const fakeWhere = {};
    const data = { privateKey: "y" };

    await expect(
      SimpleDBOps.updateNonSensitive(fakeTable, "ssh_credentials", fakeWhere, data),
    ).rejects.toThrow("privateKey");

    expect(getDb).not.toHaveBeenCalled();
  });

  it("updateNonSensitive_calls_triggerSave: after successful call for ssh_data, triggerSave called exactly once with update_nonsensitive_ssh_data", async () => {
    const fakeTable = {} as Parameters<typeof SimpleDBOps.updateNonSensitive>[0];
    const fakeWhere = {};
    const data = { credentialId: 42 };

    await SimpleDBOps.updateNonSensitive(fakeTable, "ssh_data", fakeWhere, data);

    expect(DatabaseSaveTrigger.triggerSave).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.triggerSave).toHaveBeenCalledWith("update_nonsensitive_ssh_data");
  });

  it("updateNonSensitive_does_NOT_call_validateUserAccess: spy asserts 0 calls after successful invocation", async () => {
    const fakeTable = {} as Parameters<typeof SimpleDBOps.updateNonSensitive>[0];
    const fakeWhere = {};
    const data = { credentialId: 42, authType: "credential" };

    await SimpleDBOps.updateNonSensitive(fakeTable, "ssh_data", fakeWhere, data);

    expect(DataCrypto.validateUserAccess).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// insertNonSensitive tests
// ---------------------------------------------------------------------------

describe("SimpleDBOps.insertNonSensitive", () => {
  it("insertNonSensitive_writes_non_sensitive_fields: calls getDb().insert chain with data and returns rows array", async () => {
    const fakeTable = {} as Parameters<typeof SimpleDBOps.insertNonSensitive>[0];
    const data = { userId: "other-user", credentialId: 42, authType: "credential", ip: "1.1.1.1", port: 22, name: "test" };

    const result = await SimpleDBOps.insertNonSensitive(fakeTable, "ssh_data", data);

    const db = getDb();
    expect(db.insert).toHaveBeenCalledWith(fakeTable);
    expect(result).toEqual([{ id: 1, credentialId: 42, authType: "credential" }]);
  });

  it("insertNonSensitive_throws_on_sensitive_field_in_data: passing { password: 'x' } for ssh_data throws with field name in message and does NOT reach getDb().insert", async () => {
    const fakeTable = {} as Parameters<typeof SimpleDBOps.insertNonSensitive>[0];
    const data = { userId: "other-user", password: "x" };

    await expect(
      SimpleDBOps.insertNonSensitive(fakeTable, "ssh_data", data),
    ).rejects.toThrow("password");

    expect(getDb).not.toHaveBeenCalled();
  });

  it("insertNonSensitive_throws_on_sensitive_field_for_credentials_table: passing { privateKey: 'y' } for ssh_credentials throws with privateKey in message", async () => {
    const fakeTable = {} as Parameters<typeof SimpleDBOps.insertNonSensitive>[0];
    const data = { userId: "other-user", privateKey: "y" };

    await expect(
      SimpleDBOps.insertNonSensitive(fakeTable, "ssh_credentials", data),
    ).rejects.toThrow("privateKey");

    expect(getDb).not.toHaveBeenCalled();
  });

  it("insertNonSensitive_calls_triggerSave: after successful call for ssh_data, triggerSave called exactly once with insert_nonsensitive_ssh_data", async () => {
    const fakeTable = {} as Parameters<typeof SimpleDBOps.insertNonSensitive>[0];
    const data = { userId: "other-user", credentialId: 42, ip: "1.1.1.1", port: 22, name: "test" };

    await SimpleDBOps.insertNonSensitive(fakeTable, "ssh_data", data);

    expect(DatabaseSaveTrigger.triggerSave).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.triggerSave).toHaveBeenCalledWith("insert_nonsensitive_ssh_data");
  });

  it("insertNonSensitive_does_NOT_call_validateUserAccess: spy asserts 0 calls after successful invocation", async () => {
    const fakeTable = {} as Parameters<typeof SimpleDBOps.insertNonSensitive>[0];
    const data = { userId: "other-user", credentialId: 42, ip: "1.1.1.1", port: 22, name: "test" };

    await SimpleDBOps.insertNonSensitive(fakeTable, "ssh_data", data);

    expect(DataCrypto.validateUserAccess).toHaveBeenCalledTimes(0);
  });
});
