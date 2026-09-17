const Database = require('better-sqlite3');

function initDb() {
  const dataDir = process.env.DATA_DIR || __dirname + '/../data';
  const dbFile = dataDir + '/srs-manager.db';
  const conn = new Database(dbFile);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  last_login_at TEXT,
  login_fail_count INTEGER DEFAULT 0,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip TEXT,
  success INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS streams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  protocol TEXT DEFAULT 'rtmp',
  push_url TEXT,
  pull_url TEXT,
  status TEXT DEFAULT 'offline',
  last_online_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  bitrate INTEGER DEFAULT 0,
  viewers INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cdn_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id INTEGER,
  channel_name TEXT NOT NULL,
  channel_id TEXT,
  push_domain TEXT,
  push_url TEXT,
  pull_url_hls TEXT,
  pull_url_rtmp TEXT,
  status TEXT DEFAULT 'offline',
  region TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stream_id) REFERENCES streams(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wangsu_auth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  access_key_id TEXT NOT NULL,
  access_key_secret TEXT NOT NULL,
  auth_method TEXT DEFAULT 'AKSK',
  verified INTEGER DEFAULT 0,
  verified_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  stream_id INTEGER,
  channel_id INTEGER,
  key TEXT NOT NULL,
  description TEXT,
  expires_at TEXT,
  auto_rotate_days INTEGER,
  last_rotated_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stream_id) REFERENCES streams(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES cdn_channels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS distribution_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id INTEGER,
  channel_id INTEGER,
  applicant TEXT NOT NULL,
  region TEXT,
  purpose TEXT,
  pull_url TEXT,
  expires_at TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  extended_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stream_id) REFERENCES streams(id) ON DELETE SET NULL,
  FOREIGN KEY (channel_id) REFERENCES cdn_channels(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES distribution_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  protocol TEXT DEFAULT 'rtmp',
  pull_mode TEXT DEFAULT 'pull',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pull_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id INTEGER NOT NULL UNIQUE,
  external_source_id INTEGER NOT NULL,
  desired_state TEXT NOT NULL DEFAULT 'STOPPED' CHECK(desired_state IN ('RUNNING', 'STOPPED')),
  runtime_state TEXT NOT NULL DEFAULT 'STOPPED' CHECK(runtime_state IN ('STOPPED', 'STARTING', 'RUNNING', 'RETRYING', 'FAILED', 'BLOCKED')),
  attempt INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_started_at TEXT,
  last_stopped_at TEXT,
  next_retry_at TEXT,
  worker_instance_id TEXT,
  active_source_id INTEGER,
  last_source_switch_at TEXT,
  last_source_switch_reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stream_id) REFERENCES streams(id) ON DELETE CASCADE,
  FOREIGN KEY (external_source_id) REFERENCES external_sources(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_pull_tasks_desired_runtime ON pull_tasks(desired_state, runtime_state);
CREATE INDEX IF NOT EXISTS idx_pull_tasks_source ON pull_tasks(external_source_id);

CREATE TABLE IF NOT EXISTS pull_task_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pull_task_id INTEGER NOT NULL,
  external_source_id INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pull_task_id) REFERENCES pull_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (external_source_id) REFERENCES external_sources(id) ON DELETE RESTRICT,
  UNIQUE(pull_task_id, external_source_id),
  UNIQUE(pull_task_id, priority)
);

CREATE INDEX IF NOT EXISTS idx_pull_task_sources_task_priority ON pull_task_sources(pull_task_id, enabled, priority);

CREATE TABLE IF NOT EXISTS forward_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id INTEGER NOT NULL,
  external_source_id INTEGER,
  target_type TEXT NOT NULL,
  target_url TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'idle',
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stream_id) REFERENCES streams(id) ON DELETE CASCADE,
  FOREIGN KEY (external_source_id) REFERENCES external_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transcode_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vcodec TEXT,
  acodec TEXT,
  video_config TEXT,
  audio_config TEXT,
  output_format TEXT DEFAULT 'flv',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  stream_name TEXT NOT NULL,
  processed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_type, stream_name)
);

CREATE TABLE IF NOT EXISTS aliyun_dns_auth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  access_key_id TEXT NOT NULL,
  access_key_secret TEXT NOT NULL,
  verified INTEGER DEFAULT 0,
  verified_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dns_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id TEXT,
  record_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  ttl INTEGER DEFAULT 600,
  status TEXT DEFAULT 'active',
  source TEXT DEFAULT 'manual',
  channel_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES cdn_channels(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (
  'admin',
  'default_change_me',
  'admin'
);`);

  // Lightweight migrations for tables created by older versions.
  const ensureColumn = (table, column, ddl) => {
    const cols = conn.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(column)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  ensureColumn('streams', 'updated_at', 'updated_at TEXT');
  ensureColumn('streams', 'transcode_template_id', 'transcode_template_id INTEGER');
  ensureColumn('cdn_channels', 'updated_at', 'updated_at TEXT');
  ensureColumn('distribution_requests', 'notes', 'notes TEXT');
  ensureColumn('distribution_requests', 'updated_at', 'updated_at TEXT');
  ensureColumn('pull_tasks', 'active_source_id', 'active_source_id INTEGER');
  ensureColumn('pull_tasks', 'last_source_switch_at', 'last_source_switch_at TEXT');
  ensureColumn('pull_tasks', 'last_source_switch_reason', 'last_source_switch_reason TEXT');

  // P3-B: migrate every legacy single-source PullTask into a one-to-many
  // source set without deleting the compatibility external_source_id column.
  conn.prepare(`
    INSERT OR IGNORE INTO pull_task_sources (pull_task_id, external_source_id, priority, enabled)
    SELECT id, external_source_id, 1, 1
    FROM pull_tasks
    WHERE external_source_id IS NOT NULL
  `).run();
  conn.prepare(`
    UPDATE pull_tasks
    SET active_source_id = external_source_id
    WHERE active_source_id IS NULL AND external_source_id IS NOT NULL
  `).run();

  const adminHash = process.env.ADMIN_PASSWORD_HASH || 'default_change_me';
  conn.prepare('UPDATE users SET password_hash = ? WHERE username = ? AND password_hash = ?')
    .run(adminHash, process.env.ADMIN_USER || 'admin', 'default_change_me');
  return conn;
}

module.exports = initDb();
