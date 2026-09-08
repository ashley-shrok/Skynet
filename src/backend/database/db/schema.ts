import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Phase 85 (D-22) — INVARIANT: any code that deletes a users row MUST call
// unlinkUserAvatar(avatarPath) first (via the shared helper from
// routes/user-avatar-storage.ts). Wired sites: delete-user-data.ts (covers
// admin-delete + OIDC-merge), users.ts DELETE /users/delete-account,
// users.ts POST /users/create rollback (Plan 03).
// OIDC-callback rollback (users.ts registerOIDCUser catch) is deliberately
// exempt per Plan 03 Task 1 Step 10 — OIDC create bypasses the D-07
// mandatoriness gate, so no avatar file is ever written on that path.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),

  isOidc: integer("is_oidc", { mode: "boolean" }).notNull().default(false),
  oidcIdentifier: text("oidc_identifier"),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  issuerUrl: text("issuer_url"),
  authorizationUrl: text("authorization_url"),
  tokenUrl: text("token_url"),
  identifierPath: text("identifier_path"),
  namePath: text("name_path"),
  scopes: text().default("openid email profile"),

  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  totpBackupCodes: text("totp_backup_codes"),

  // Phase 88 slice A (D-14 housekeeping) — mxid mapping for the Matrix relay.
  // Skynet mints the whole Matrix account (via createOrUpdateUser in
  // matrix-admin-client.ts) as part of POST /users/create; the mxid is
  // populated in the same INSERT that writes the user row. New-user mxids
  // follow `@<sanitized-username>_human:<server_name>` (bijective sanitizer,
  // `_human` suffix per D-06). Legacy users (Ashley/Zoey/Laura on t1000,
  // imported before slice A) have suffix-less mxids that continue to work
  // indefinitely. Nullable: OIDC users (D-12 out of scope) and legacy
  // pre-Phase-88 users may still have mxid=null. POST /users/:id/mxid
  // (user-admin-routes.ts) is untouched — kept for admin-manual mxid
  // association. DELETE /users/delete-account and deleteUserAndRelatedData
  // now deactivate the Matrix account (best-effort, D-10) when mxid is set.
  // Skynet holds no password for this account: mint password is discarded;
  // runtime access tokens come from admin loginAsUser (deferred to later
  // sub-slice per D-13). Agents' relay identifiers live on-disk in
  // ~/.claude/identities/<name>/relay.json per fleet convention (unchanged).
  mxid: text("mxid"),

  // Phase 85 (locked decision D-04) — pointer to this user's avatar image
  // file on disk under ${DATA_DIR}/user-avatars/. NOT bytes, NOT an absolute
  // path, NOT an external URL — just the filename (userId + ext) so the row
  // is enough to reconstruct the file location given DATA_DIR alone (D-05:
  // deterministic + resolvable from DATA_DIR). Nullable so pre-existing rows
  // remain valid (D-13 defers backfill until a downstream mechanism sets one
  // via PUT /users/:id/avatar per D-10). Mandatoriness on new-user creation
  // is enforced at POST /users/create per D-07, not at the schema level (D-06).
  avatarPath: text("avatar_path"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  jwtToken: text("jwt_token").notNull(),
  deviceType: text("device_type").notNull(),
  deviceInfo: text("device_info").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  lastActiveAt: text("last_active_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const trustedDevices = sqliteTable("trusted_devices", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceFingerprint: text("device_fingerprint").notNull(),
  deviceType: text("device_type").notNull(),
  deviceInfo: text("device_info").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  lastUsedAt: text("last_used_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const hosts = sqliteTable("ssh_data", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  connectionType: text("connection_type").notNull().default("ssh"),
  name: text("name"),
  ip: text("ip").notNull(),
  port: integer("port").notNull(),
  username: text("username").notNull(),
  folder: text("folder"),
  tags: text("tags"),
  pin: integer("pin", { mode: "boolean" }).notNull().default(false),
  authType: text("auth_type").notNull(),
  forceKeyboardInteractive: text("force_keyboard_interactive"),

  password: text("password"),
  key: text("key", { length: 8192 }),
  keyPassword: text("key_password"),
  keyType: text("key_type"),
  sudoPassword: text("sudo_password"),

  autostartPassword: text("autostart_password"),
  autostartKey: text("autostart_key", { length: 8192 }),
  autostartKeyPassword: text("autostart_key_password"),

  credentialId: integer("credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
  overrideCredentialUsername: integer("override_credential_username", {
    mode: "boolean",
  }),
  enableTerminal: integer("enable_terminal", { mode: "boolean" })
    .notNull()
    .default(true),
  enableTunnel: integer("enable_tunnel", { mode: "boolean" })
    .notNull()
    .default(true),
  tunnelConnections: text("tunnel_connections"),
  jumpHosts: text("jump_hosts"),
  enableFileManager: integer("enable_file_manager", { mode: "boolean" })
    .notNull()
    .default(true),
  enableDocker: integer("enable_docker", { mode: "boolean" })
    .notNull()
    .default(false),
  showTerminalInSidebar: integer("show_terminal_in_sidebar", { mode: "boolean" })
    .notNull()
    .default(true),
  showFileManagerInSidebar: integer("show_file_manager_in_sidebar", { mode: "boolean" })
    .notNull()
    .default(false),
  showTunnelInSidebar: integer("show_tunnel_in_sidebar", { mode: "boolean" })
    .notNull()
    .default(false),
  showDockerInSidebar: integer("show_docker_in_sidebar", { mode: "boolean" })
    .notNull()
    .default(false),
  showServerStatsInSidebar: integer("show_server_stats_in_sidebar", { mode: "boolean" })
    .notNull()
    .default(false),
  defaultPath: text("default_path"),
  statsConfig: text("stats_config"),
  dockerConfig: text("docker_config"),
  terminalConfig: text("terminal_config"),
  quickActions: text("quick_actions"),
  notes: text("notes"),
  enableSsh: integer("enable_ssh", { mode: "boolean" }).notNull().default(true),
  enableRdp: integer("enable_rdp", { mode: "boolean" }).notNull().default(false),
  enableVnc: integer("enable_vnc", { mode: "boolean" }).notNull().default(false),
  enableTelnet: integer("enable_telnet", { mode: "boolean" }).notNull().default(false),

  // Phase 72 Plan 02 — opt-in flag for the fleet-substrate reconcile sweep.
  // Default false means no host is touched by the sweep unless an operator
  // (or the provisioning path for freshly-created exec VMs) flips it to true.
  runsFleetSubstrate: integer("runs_fleet_substrate", { mode: "boolean" }).notNull().default(false),

  sshPort: integer("ssh_port").default(22),
  rdpPort: integer("rdp_port").default(3389),
  vncPort: integer("vnc_port").default(5900),
  telnetPort: integer("telnet_port").default(23),

  rdpUser: text("rdp_user"),
  rdpPassword: text("rdp_password"),
  rdpDomain: text("rdp_domain"),
  rdpSecurity: text("rdp_security"),
  rdpIgnoreCert: integer("rdp_ignore_cert", { mode: "boolean" }).default(false),

  vncPassword: text("vnc_password"),
  vncUser: text("vnc_user"),

  telnetUser: text("telnet_user"),
  telnetPassword: text("telnet_password"),

  domain: text("domain"),
  security: text("security"),
  ignoreCert: integer("ignore_cert", { mode: "boolean" }).default(false),
  guacamoleConfig: text("guacamole_config"),

  useSocks5: integer("use_socks5", { mode: "boolean" }),
  socks5Host: text("socks5_host"),
  socks5Port: integer("socks5_port"),
  socks5Username: text("socks5_username"),
  socks5Password: text("socks5_password"),
  socks5ProxyChain: text("socks5_proxy_chain"),

  macAddress: text("mac_address"),
  portKnockSequence: text("port_knock_sequence"),

  hostKeyFingerprint: text("host_key_fingerprint"),
  hostKeyType: text("host_key_type"),
  hostKeyAlgorithm: text("host_key_algorithm").default("sha256"),
  hostKeyFirstSeen: text("host_key_first_seen"),
  hostKeyLastVerified: text("host_key_last_verified"),
  hostKeyChangedCount: integer("host_key_changed_count").default(0),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const fileManagerRecent = sqliteTable("file_manager_recent", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  lastOpened: text("last_opened")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const fileManagerPinned = sqliteTable("file_manager_pinned", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  pinnedAt: text("pinned_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const fileManagerShortcuts = sqliteTable("file_manager_shortcuts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const transferRecent = sqliteTable("transfer_recent", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sourceHostId: integer("source_host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  destHostId: integer("dest_host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  destPath: text("dest_path").notNull(),
  destPathLabel: text("dest_path_label").notNull(),
  lastUsed: text("last_used")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const dismissedAlerts = sqliteTable("dismissed_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  alertId: text("alert_id").notNull(),
  dismissedAt: text("dismissed_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sshCredentials = sqliteTable("ssh_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  folder: text("folder"),
  tags: text("tags"),
  authType: text("auth_type").notNull(),
  username: text("username"),
  password: text("password"),
  key: text("key", { length: 16384 }),
  privateKey: text("private_key", { length: 16384 }),
  publicKey: text("public_key", { length: 4096 }),
  keyPassword: text("key_password"),
  keyType: text("key_type"),
  detectedKeyType: text("detected_key_type"),

  certPublicKey: text("cert_public_key", { length: 8192 }),

  systemPassword: text("system_password"),
  systemKey: text("system_key", { length: 16384 }),
  systemKeyPassword: text("system_key_password"),

  usageCount: integer("usage_count").notNull().default(0),
  lastUsed: text("last_used"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sshCredentialUsage = sqliteTable("ssh_credential_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  credentialId: integer("credential_id")
    .notNull()
    .references(() => sshCredentials.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  usedAt: text("used_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const snippets = sqliteTable("snippets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  content: text("content").notNull(),
  description: text("description"),
  folder: text("folder"),
  order: integer("order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  hostFilter: text("host_filter"),
});

export const snippetFolders = sqliteTable("snippet_folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  icon: text("icon"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const c2sTunnelPresets = sqliteTable("c2s_tunnel_presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  config: text("config").notNull(),
  platform: text("platform"),
  computerName: text("computer_name"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const snippetAccess = sqliteTable("snippet_access", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  snippetId: integer("snippet_id")
    .notNull()
    .references(() => snippets.id, { onDelete: "cascade" }),

  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  roleId: integer("role_id").references(() => roles.id, {
    onDelete: "cascade",
  }),

  grantedBy: text("granted_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  permissionLevel: text("permission_level").notNull().default("view"),

  expiresAt: text("expires_at"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sshFolders = sqliteTable("ssh_folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  icon: text("icon"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const recentActivity = sqliteTable("recent_activity", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  hostName: text("host_name"),
  timestamp: text("timestamp")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const commandHistory = sqliteTable("command_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  command: text("command").notNull(),
  executedAt: text("executed_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const networkTopology = sqliteTable("network_topology", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  topology: text("topology"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const dashboardPreferences = sqliteTable("dashboard_preferences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  layout: text("layout").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const hostAccess = sqliteTable("host_access", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),

  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" }),
  roleId: integer("role_id")
    .references(() => roles.id, { onDelete: "cascade" }),

  grantedBy: text("granted_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  permissionLevel: text("permission_level")
    .notNull()
    .default("view"),

  expiresAt: text("expires_at"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  lastAccessedAt: text("last_accessed_at"),
  accessCount: integer("access_count").notNull().default(0),
  overrideCredentialId: integer("override_credential_id").references(
    () => sshCredentials.id,
    { onDelete: "set null" },
  ),
});

export const sharedCredentials = sqliteTable("shared_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  hostAccessId: integer("host_access_id")
    .notNull()
    .references(() => hostAccess.id, { onDelete: "cascade" }),

  originalCredentialId: integer("original_credential_id")
    .notNull()
    .references(() => sshCredentials.id, { onDelete: "cascade" }),

  targetUserId: text("target_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  encryptedUsername: text("encrypted_username").notNull(),
  encryptedAuthType: text("encrypted_auth_type").notNull(),
  encryptedPassword: text("encrypted_password"),
  encryptedKey: text("encrypted_key", { length: 16384 }),
  encryptedKeyPassword: text("encrypted_key_password"),
  encryptedKeyType: text("encrypted_key_type"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),

  needsReEncryption: integer("needs_re_encryption", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),

  isSystem: integer("is_system", { mode: "boolean" })
    .notNull()
    .default(false),

  permissions: text("permissions"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const userRoles = sqliteTable("user_roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  roleId: integer("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),

  grantedBy: text("granted_by").references(() => users.id, {
    onDelete: "set null",
  }),
  grantedAt: text("granted_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  username: text("username").notNull(),

  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  resourceName: text("resource_name"),

  details: text("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  success: integer("success", { mode: "boolean" }).notNull(),
  errorMessage: text("error_message"),

  timestamp: text("timestamp")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sessionRecordings = sqliteTable("session_recordings", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessId: integer("access_id").references(() => hostAccess.id, {
    onDelete: "set null",
  }),

  startedAt: text("started_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  endedAt: text("ended_at"),
  duration: integer("duration"),

  commands: text("commands"),
  dangerousActions: text("dangerous_actions"),

  recordingPath: text("recording_path"),

  terminatedByOwner: integer("terminated_by_owner", { mode: "boolean" })
    .default(false),
  terminationReason: text("termination_reason"),
});

export const opksshTokens = sqliteTable("opkssh_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),

  sshCert: text("ssh_cert", { length: 8192 }).notNull(),
  privateKey: text("private_key", { length: 8192 }).notNull(),

  email: text("email"),
  sub: text("sub"),
  issuer: text("issuer"),
  audience: text("audience"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  lastUsed: text("last_used"),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at"),
  lastUsedAt: text("last_used_at"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

// Phase 75 Plan 01 — singleton store for the @skynet-admin Matrix relay
// credentials. One row (id=1 by convention) holds the homeserver base URL,
// the admin mxid, the admin access_token, and the admin password.
//
// The `access_token` and `password` columns are FieldCrypto-encrypted at
// rest per field-crypto.ts ENCRYPTED_FIELDS["matrix_admin_creds"] — writes
// go through matrix-admin-creds-store.ts (Task 2 below), which eagerly
// encrypts before Drizzle INSERT/UPDATE, and reads round-trip through
// FieldCrypto.decryptField.
//
// This is the sole set of Matrix credentials stored in Skynet DB — the
// @skynet-admin singleton used by matrix-admin-client for every admin API
// call (createOrUpdateUser, deactivateUser, loginAsUser). Agent relay creds
// live on-disk at ~/.claude/identities/<name>/relay.json per fleet convention
// (Phase 69) — unchanged. Phase 88 slice A (D-14): human relay accounts are
// Skynet-owned — Skynet mints via admin API (createOrUpdateUser) with a
// Skynet-generated password that is discarded on the spot. Humans hold no
// credential of their own for their Matrix account. Runtime access tokens
// come from admin loginAsUser (deferred to later sub-slice per D-13). Direct
// human login to Matrix clients (Element etc.) is explicitly not supported
// (D-08 rationale). The prior claim that humans own their relay credentials
// is retired; Skynet-owned accounts are mediated entirely by this admin cred.
export const matrixAdminCreds = sqliteTable("matrix_admin_creds", {
  id: integer("id").primaryKey(),
  homeserverBase: text("homeserver_base").notNull(),
  userId: text("user_id").notNull(),
  accessToken: text("access_token").notNull(),
  password: text("password").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Phase 79 Plan 01 — per-identity Telegram bot tokens. One row per identity
// (identity_key primary key), mirrors the matrix_admin_creds FieldCrypto shape
// per identity (not singleton). The `bot_token` column is AES-256-GCM
// encrypted at rest via field-crypto.ts ENCRYPTED_FIELDS["telegram_bot_tokens"]
// — writes go through tokens-store.ts, which eagerly encrypts before Drizzle
// INSERT/UPDATE. `bot_username` is display-only (safe to log); `human_user_id`
// is the authz key (only that Skynet user can activate/disconnect this row);
// `telegram_chat_id` is nullable until the first `/start` message is seen.
export const telegramBotTokens = sqliteTable("telegram_bot_tokens", {
  identityKey: text("identity_key").primaryKey(),
  botToken: text("bot_token").notNull(),
  botUsername: text("bot_username").notNull(),
  humanUserId: text("human_user_id").notNull(),
  telegramChatId: text("telegram_chat_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Phase 68: identities table dropped; identity IS the disk folder on some
// host per .planning/shapes/shape-kill-identities-table.md. The `identities`
// schema export is removed — the table no longer exists in any install.

export const messageQueueItems = sqliteTable("message_queue_items", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  tmuxSession: text("tmux_session"),
  body: text("body").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Patch #57: per-pane ComposeBox draft persistence. Singleton row per
// (userId, hostId, tmuxSession) — no `id` primary key column; composite
// PK is enforced by the CREATE TABLE statement in db/index.ts, not by
// Drizzle's type definition. `tmuxSession` is stored as `NOT NULL DEFAULT ''`
// at the SQL layer (SQLite treats NULL as distinct in UNIQUE / PRIMARY KEY,
// which would break the ON CONFLICT upsert path for non-tmux hosts); the
// column here mirrors messageQueueItems' `text("tmux_session")` typing for
// consistency at the ORM boundary but the route layer coalesces null → ''
// before every insert / update / select.
export const composeDrafts = sqliteTable("compose_drafts", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  tmuxSession: text("tmux_session").notNull().default(""),
  body: text("body").notNull().default(""),
  queueSlots: text("queue_slots").notNull().default("[]"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const userOpenTabs = sqliteTable("user_open_tabs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tabType: text("tab_type").notNull(),
  hostId: integer("host_id").references(() => hosts.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  tabOrder: integer("tab_order").notNull().default(0),
  backendSessionId: text("backend_session_id"),
  targetTmuxSession: text("target_tmux_session"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  reopenTabsOnLogin: integer("reopen_tabs_on_login", { mode: "boolean" })
    .notNull()
    .default(false),
  theme: text("theme"),
  fontSize: text("font_size"),
  accentColor: text("accent_color"),
  language: text("language"),
  pinnedConversationIds: text("pinned_conversation_ids"),
  hiddenConversationIds: text("hidden_conversation_ids"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Phase 85 (D-01, D-02): identity_send_log — records when Ashley last sent a
// message from Skynet's compose surface to this identity, keyed on identity
// name only (Skynet single-tenant). Consumed by ssh-poll-orchestrator for the
// middle-zone recency signal. `lastSendAt` holds unix millis (nullable never
// at the SQL layer — a row only exists after Ashley's first send).
export const identitySendLog = sqliteTable("identity_send_log", {
  identityName: text("identity_name").primaryKey(),
  lastSendAt: integer("last_send_at").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Phase 89 Plan 01 (D-01, D-02) — relay_room_sessions: the stored side of
// Skynet's new second session-kind. Rows anchored to (user_id, room_id);
// the CREATE UNIQUE INDEX on (user_id, room_id) in db/index.ts is the
// coordinator between the observation loop and slice C's create-room flow
// (D-14 — schema is the coordinator, no cross-path logic). Reactivation on
// re-invite flips state='inactive' → 'active' on the SAME row (D-03), so
// the uniqueness constraint is UNSCOPED — do NOT add a partial-index
// predicate. The store module owns the state values (SQLite has no enum):
// `active` | `inactive`. See relay-room-sessions-store.ts. Writes must be
// paired with DatabaseSaveTrigger.forceSave("phase-89-...") per the
// crown-jewel in-memory-DB invariant.
export const relayRoomSessions = sqliteTable("relay_room_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  roomId: text("room_id").notNull(),
  roomTitle: text("room_title"),
  state: text("state").notNull(),
  lastActivityAt: text("last_activity_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Phase 89 Plan 01 (D-16) — admin_rooms: Skynet-instance-owned internal
// ignore-list of room IDs the observation loop must skip when
// materializing (registry rooms + any future admin-purposes-only rooms).
// Populated at the moment Skynet creates each registry room (D-10).
// Small dedicated table rather than a JSON-in-settings row — easier to
// inspect for ops debugging, negligible overhead for the ~2 rows
// expected. No FK — room IDs are freestanding Matrix identifiers. See
// admin-rooms-ignore-list.ts for the store module. Writes must be paired
// with DatabaseSaveTrigger.forceSave("phase-89-...").
//
// Scope per D-16 — SINGLE-INSTANCE-PER-DB. Each Skynet instance owns its
// own DB. If Skynet is ever operated multi-tenant (one DB, multiple
// Skynet "instances"), this table needs a `skynet_instance_id` column
// added — otherwise different instances' registry-room IDs would
// collide in the same table. Phase 89 fixup L-1 (2026-09-08).
export const adminRooms = sqliteTable("admin_rooms", {
  roomId: text("room_id").primaryKey(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
