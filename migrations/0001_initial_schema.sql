PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chord_voicings (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  root TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  tuning_json TEXT NOT NULL,
  frets_json TEXT NOT NULL,
  fingers_json TEXT,
  display_name_override TEXT,
  description TEXT NOT NULL DEFAULT '',
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  workflow_status TEXT NOT NULL CHECK (workflow_status IN ('pending', 'pre-reviewed', 'published', 'rejected')),
  catalog_json TEXT,
  provenance_json TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chord_voicings_workflow ON chord_voicings(workflow_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chord_voicings_recipe_root ON chord_voicings(recipe_id, root);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('descriptor', 'structural'))
);
CREATE TABLE IF NOT EXISTS chord_voicing_tags (
  chord_voicing_id TEXT NOT NULL REFERENCES chord_voicings(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (chord_voicing_id, tag_id)
);
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chord_voicing_id TEXT REFERENCES chord_voicings(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  actor_identifier TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE TABLE IF NOT EXISTS quarantined_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  issues_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
