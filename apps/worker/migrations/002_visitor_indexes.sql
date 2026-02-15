-- Add indexes for visitor analytics queries
-- See: https://github.com/andrewmurphyio/gitly.sh/issues/128

-- Index for visitor_hash lookups
CREATE INDEX IF NOT EXISTS idx_clicks_visitor_hash ON clicks(visitor_hash);

-- Composite index for time-boxed unique visitor queries per slug
CREATE INDEX IF NOT EXISTS idx_clicks_visitor_slug ON clicks(visitor_hash, slug);
