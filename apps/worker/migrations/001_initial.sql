-- Initial schema for gitly.sh
-- Per ADR-006: Data Model

-- Links table for admin/search queries (KV handles fast redirects)
CREATE TABLE IF NOT EXISTS links (
  slug TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  expires_at INTEGER,
  clicks INTEGER DEFAULT 0
);

-- Clicks table for analytics (per ADR-007)
CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  clicked_at INTEGER NOT NULL,
  referrer TEXT,
  country TEXT,
  city TEXT,
  device_type TEXT,
  browser TEXT,
  os TEXT,
  visitor_hash TEXT,
  user_agent TEXT,
  FOREIGN KEY (slug) REFERENCES links(slug)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_clicks_slug ON clicks(slug);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);
CREATE INDEX IF NOT EXISTS idx_clicks_slug_clicked_at ON clicks(slug, clicked_at);
