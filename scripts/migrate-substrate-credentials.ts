/**
 * migrate-substrate-credentials.ts
 *
 * Operator CLI entrypoint for Phase 75-08: one-shot migration that transitions
 * existing substrate-host credentials from per-user-DEK-only to CSKEK-wrapped.
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   npx tsx scripts/migrate-substrate-credentials.ts < input.json
 *
 * ─── INPUT FORMAT (stdin) ────────────────────────────────────────────────────
 *
 *   JSON array of {userId, password} entries, one per owner of substrate hosts:
 *
 *   [
 *     {"userId": "user-abc-123", "password": "their-login-password"},
 *     {"userId": "user-def-456", "password": "their-login-password"}
 *   ]
 *
 * ─── OUTPUT FORMAT (stdout) ──────────────────────────────────────────────────
 *
 *   MigrationResult JSON (pretty-printed):
 *   {
 *     "preCheck": { "inlineCredentialSubstrateHosts": [] },
 *     "perUser": [
 *       { "userId": "...", "migrated": 2, "failed": 0, "skipped": 0, "hosts": [...] }
 *     ],
 *     "aborted": false
 *   }
 *
 * ─── EXIT CODES ──────────────────────────────────────────────────────────────
 *
 *   0  Migration completed (check perUser[].failed for per-host failures)
 *   1  Pre-check aborted — inline-credential substrate hosts found (check preCheck)
 *   2  Fatal error (bad stdin, JSON parse failure, DB initialization failure)
 *
 * ─── SECURITY NOTES ──────────────────────────────────────────────────────────
 *
 *   - stdin contains plaintext passwords. NEVER commit captured input files.
 *   - Prepare the input file with `chmod 600` before writing passwords.
 *   - Do NOT paste passwords interactively — pipe from a file:
 *       npx tsx scripts/migrate-substrate-credentials.ts < ~/secure-input.json
 *   - The script NEVER echoes or logs the input passwords.
 *   - Result JSON written to stdout does NOT contain passwords.
 *
 * ─── D-15 REMINDER ───────────────────────────────────────────────────────────
 *
 *   This script is intended for one-shot operator use after Phase 75 ships.
 *   Retire (delete) this script after both live instances have been migrated.
 *   New substrate hosts provisioned after Phase 75 ships go straight into the
 *   CSKEK model at create time — no migration needed for them.
 *
 * ─── RUNBOOK (Alice) ────────────────────────────────────────────────────────
 *
 *   1. Prepare input.json (chmod 600 before writing):
 *        chmod 600 ~/known-users.json
 *        cat > ~/known-users.json << 'EOF'
 *        [
 *          {"userId": "<userId>", "password": "<password>"},
 *          ...
 *        ]
 *        EOF
 *
 *   2. Run the migration inside the container:
 *        docker exec -i <container-name> npx tsx scripts/migrate-substrate-credentials.ts < ~/known-users.json
 *
 *   3. Inspect stdout. Verify aborted=false and perUser[].failed=0 for all users.
 *
 *   4. Repeat on the second instance (T800).
 *
 *   5. Delete this script and ~/known-users.json from both machines.
 */

async function main(): Promise<number> {
  // ─── Step 1: Read all of stdin ─────────────────────────────────────────────
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (!raw) {
    process.stderr.write("Error: no input received on stdin. Pipe a JSON array of {userId, password} entries.\n");
    return 2;
  }

  // ─── Step 2: Parse JSON ────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `Error: failed to parse stdin as JSON: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  // ─── Step 3: Validate input shape ─────────────────────────────────────────
  if (!Array.isArray(parsed)) {
    process.stderr.write("Error: stdin must be a JSON array of {userId, password} objects.\n");
    return 2;
  }

  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).userId !== "string" ||
      typeof (entry as Record<string, unknown>).password !== "string"
    ) {
      process.stderr.write(
        `Error: entry at index ${i} is missing a string userId or string password field.\n`,
      );
      return 2;
    }
  }

  const input = parsed as Array<{ userId: string; password: string }>;

  // ─── Step 4: Initialize DB (lazy, after input is validated) ────────────────
  // Dynamic import fires AFTER validation so bad stdin does not start the DB.
  // getDb() throws if initializeDatabase() has not been called — we must call it.
  let initializeDatabase: () => Promise<void>;
  let migrateSubstrateCredentials: (
    input: Array<{ userId: string; password: string }>
  ) => Promise<{
    preCheck: { inlineCredentialSubstrateHosts: number[] };
    perUser: Array<unknown>;
    aborted: boolean;
  }>;

  try {
    const dbModule = await import("../src/backend/database/db/index.js");
    initializeDatabase = dbModule.initializeDatabase;
    const migModule = await import("../src/backend/utils/substrate-credential-migration.js");
    migrateSubstrateCredentials = migModule.migrateSubstrateCredentials;
  } catch (importErr) {
    process.stderr.write(
      `Fatal error: failed to import modules: ${importErr instanceof Error ? importErr.message : String(importErr)}\n`,
    );
    return 2;
  }

  try {
    await initializeDatabase();
  } catch (initErr) {
    process.stderr.write(
      `Fatal error: database initialization failed: ${initErr instanceof Error ? initErr.message : String(initErr)}\n`,
    );
    return 2;
  }

  // ─── Step 5: Run the migration ─────────────────────────────────────────────
  const result = await migrateSubstrateCredentials(input);

  // ─── Step 6: Belt-and-suspenders — zero out input passwords ───────────────
  // The migration module already zeroed the derived DEKs.
  // This additionally clears the plaintext passwords from the input array
  // so they do not linger in memory after the migration completes.
  for (const entry of input) {
    // Overwrite the string value with an empty string (JS strings are immutable
    // so we cannot zero them in place, but we can drop the reference).
    (entry as Record<string, unknown>).password = "";
  }

  // ─── Step 7: Write result JSON to stdout ──────────────────────────────────
  // stdout is the structured result channel only — do NOT use console output methods.
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");

  // ─── Step 8: Return exit code ──────────────────────────────────────────────
  return result.aborted ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
