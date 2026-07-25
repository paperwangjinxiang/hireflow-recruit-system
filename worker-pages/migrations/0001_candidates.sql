DROP TABLE IF EXISTS fts5_probe;
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  name TEXT,
  cert_level TEXT,
  cert_subject TEXT,
  school TEXT,
  grad_year INTEGER,
  stage TEXT,
  owner TEXT,
  status TEXT,
  tags TEXT,
  search_text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidates_stage ON candidates(stage);
CREATE INDEX IF NOT EXISTS idx_candidates_owner ON candidates(owner);
CREATE INDEX IF NOT EXISTS idx_candidates_cert ON candidates(cert_subject, cert_level);
CREATE INDEX IF NOT EXISTS idx_candidates_updated ON candidates(updated_at);
CREATE VIRTUAL TABLE IF NOT EXISTS candidates_fts USING fts5(id UNINDEXED, search_text);
