PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL,
  provider TEXT,
  account_status TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  created_date TEXT,
  updated_date TEXT,
  last_login_date TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(account_status);

CREATE TABLE IF NOT EXISTS auth_events (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  type TEXT NOT NULL,
  created_date TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_events_email ON auth_events(email);
CREATE INDEX IF NOT EXISTS idx_auth_events_created_date ON auth_events(created_date DESC);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  remember INTEGER NOT NULL DEFAULT 0,
  device_id TEXT,
  ip TEXT,
  created_date TEXT NOT NULL,
  last_active TEXT,
  expires_at TEXT NOT NULL,
  revoked_date TEXT,
  updated_date TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_email ON auth_sessions(user_email);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_date TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  updated_date TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

CREATE TABLE IF NOT EXISTS login_throttle (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  device_id TEXT,
  ip TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TEXT,
  last_attempt_at TEXT,
  lock_until TEXT,
  updated_date TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_throttle_lookup ON login_throttle(email, device_id, ip);

CREATE TABLE IF NOT EXISTS device_sessions (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  device_id TEXT NOT NULL,
  last_active TEXT NOT NULL,
  device_info_json TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user_email ON device_sessions(user_email);
CREATE INDEX IF NOT EXISTS idx_device_sessions_device_id ON device_sessions(device_id);

CREATE TABLE IF NOT EXISTS entity_records (
  entity_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  created_by TEXT,
  created_by_email TEXT,
  created_date TEXT,
  updated_date TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (entity_name, record_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_records_entity_name ON entity_records(entity_name);
CREATE INDEX IF NOT EXISTS idx_entity_records_created_by_email ON entity_records(created_by_email);
CREATE INDEX IF NOT EXISTS idx_entity_records_updated_date ON entity_records(updated_date DESC);
