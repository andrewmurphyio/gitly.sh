#!/usr/bin/env tsx
/**
 * sync-links.ts — Parse and validate all links.csv files, sync to Cloudflare KV + D1
 *
 * Replaces the fragile bash CSV parser with proper validation:
 * - Real CSV parsing (handles commas in URLs, quoted fields)
 * - Slug validation per ADR-004 (3-50 chars, alphanumeric + hyphens)
 * - URL validation (https:// only)
 * - Duplicate slug detection across all users
 * - Syncs to both KV (for fast redirects) and D1 (for analytics/admin)
 *
 * Usage:
 *   pnpm --filter @gitly/scripts sync-links
 *
 * Environment:
 *   CLOUDFLARE_API_TOKEN  - API token with KV write + D1 write access
 *   CLOUDFLARE_ACCOUNT_ID - Account ID
 *   KV_NAMESPACE_ID       - KV namespace ID for links
 *   D1_DATABASE_ID        - D1 database ID for analytics
 *   DRY_RUN               - If "true", validate only (no KV/D1 writes)
 */

import { parse } from "csv-parse/sync";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, relative } from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LinkRecord {
  slug: string;
  url: string;
  file: string;
  line: number;
}

interface ValidationError {
  file: string;
  line: number;
  slug: string;
  error: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

// ADR-004: Custom slugs: 3-50 chars, alphanumeric + hyphens, no leading/trailing hyphens
const SLUG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,48}[a-zA-Z0-9]$/;

// Reserved slugs that would conflict with API routes
const RESERVED_SLUGS = new Set(["health", "api", "admin", "_"]);

function validateSlug(slug: string): string | null {
  if (!slug || slug.trim() === "") {
    return "Slug is empty";
  }

  const trimmed = slug.trim();

  if (trimmed.length < 3) {
    return "Slug must be at least 3 characters";
  }

  if (trimmed.length > 50) {
    return `Slug too long (${trimmed.length} chars, max 50)`;
  }

  // Check for valid characters and no leading/trailing hyphens
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(trimmed)) {
    return "Slug must be alphanumeric + hyphens, no leading/trailing hyphens";
  }

  // No consecutive hyphens
  if (/--/.test(trimmed)) {
    return "Slug cannot contain consecutive hyphens";
  }

  if (RESERVED_SLUGS.has(trimmed.toLowerCase())) {
    return `Slug "${trimmed}" is reserved`;
  }

  return null;
}

function validateUrl(url: string): string | null {
  if (!url || url.trim() === "") {
    return "URL is empty";
  }

  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);

    // Only allow https:// (security)
    if (parsed.protocol !== "https:") {
      return `Only HTTPS URLs allowed (got ${parsed.protocol})`;
    }

    // Basic sanity checks
    if (!parsed.hostname || parsed.hostname.length < 3) {
      return "Invalid hostname";
    }

    return null;
  } catch {
    return "Invalid URL format";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV Parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseCSVFile(filePath: string, repoRoot: string): LinkRecord[] {
  const content = readFileSync(filePath, "utf-8");
  const relativePath = relative(repoRoot, filePath);

  // Parse with proper CSV handling (commas in quoted fields, etc.)
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  return records.map((record: Record<string, string>, index: number) => ({
    slug: record.slug?.trim() || "",
    url: record.url?.trim() || "",
    file: relativePath,
    line: index + 2, // +2 for header row and 1-based indexing
  }));
}

function discoverCSVFiles(linksDir: string): string[] {
  if (!existsSync(linksDir)) {
    console.log(`Links directory not found: ${linksDir}`);
    return [];
  }

  const files: string[] = [];
  const users = readdirSync(linksDir, { withFileTypes: true });

  for (const user of users) {
    if (user.isDirectory()) {
      const csvPath = join(linksDir, user.name, "links.csv");
      if (existsSync(csvPath)) {
        files.push(csvPath);
      }
    }
  }

  return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// KV Sync
// ─────────────────────────────────────────────────────────────────────────────

async function syncToKV(links: LinkRecord[]): Promise<void> {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const namespaceId = process.env.KV_NAMESPACE_ID;

  if (!apiToken || !accountId || !namespaceId) {
    throw new Error(
      "Missing required env vars: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_NAMESPACE_ID"
    );
  }

  // Use bulk write API for efficiency (up to 10,000 keys per request)
  // Store full LinkData object for richer metadata
  const now = Math.floor(Date.now() / 1000);
  const bulkData = links.map((link) => ({
    key: link.slug,
    value: JSON.stringify({
      url: link.url,
      createdAt: now,
      createdBy: link.file.split("/")[1] || "unknown", // Extract username from path
    }),
  }));

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bulkData),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`KV bulk write failed: ${response.status} - ${error}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(`KV bulk write failed: ${JSON.stringify(result.errors)}`);
  }
}

async function syncToD1(links: LinkRecord[]): Promise<void> {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.D1_DATABASE_ID;

  if (!apiToken || !accountId || !databaseId) {
    throw new Error(
      "Missing required env vars: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID"
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // Use D1 HTTP API to upsert links
  // We use INSERT OR REPLACE to handle both new and existing links
  for (const link of links) {
    const createdBy = link.file.split("/")[1] || "unknown";

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: `INSERT INTO links (slug, url, created_at, created_by, clicks) 
                VALUES (?1, ?2, ?3, ?4, 0)
                ON CONFLICT(slug) DO UPDATE SET url = ?2`,
          params: [link.slug, link.url, now, createdBy],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`D1 insert failed for ${link.slug}: ${response.status} - ${error}`);
    }

    const result: any = await response.json();
    if (!result.success) {
      throw new Error(`D1 insert failed for ${link.slug}: ${JSON.stringify(result.errors)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "true";
  // Look for links dir relative to repo root (parent of scripts/)
  const repoRoot = join(import.meta.dirname, "..");
  const linksDir = join(repoRoot, "links");

  console.log(`🔗 sync-links.ts — ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`   Links directory: ${linksDir}\n`);

  // Discover all CSV files
  const csvFiles = discoverCSVFiles(linksDir);
  if (csvFiles.length === 0) {
    console.log("No CSV files found. Nothing to sync.");
    process.exit(0);
  }

  console.log(`Found ${csvFiles.length} CSV file(s):\n`);

  // Parse all files
  const allLinks: LinkRecord[] = [];
  const errors: ValidationError[] = [];

  for (const file of csvFiles) {
    console.log(`  📄 ${relative(repoRoot, file)}`);
    try {
      const links = parseCSVFile(file, repoRoot);
      allLinks.push(...links);
      console.log(`     ${links.length} link(s)`);
    } catch (err) {
      console.error(`     ❌ Parse error: ${err}`);
      errors.push({
        file: relative(repoRoot, file),
        line: 0,
        slug: "",
        error: `CSV parse error: ${err}`,
      });
    }
  }

  console.log(`\n📋 Validating ${allLinks.length} link(s)...\n`);

  // Validate all links
  const slugMap = new Map<string, LinkRecord>();

  for (const link of allLinks) {
    // Validate slug
    const slugError = validateSlug(link.slug);
    if (slugError) {
      errors.push({
        file: link.file,
        line: link.line,
        slug: link.slug,
        error: `Invalid slug: ${slugError}`,
      });
      continue;
    }

    // Validate URL
    const urlError = validateUrl(link.url);
    if (urlError) {
      errors.push({
        file: link.file,
        line: link.line,
        slug: link.slug,
        error: `Invalid URL: ${urlError}`,
      });
      continue;
    }

    // Check for duplicates (case-insensitive for safety)
    const normalizedSlug = link.slug.toLowerCase();
    const existing = slugMap.get(normalizedSlug);
    if (existing) {
      errors.push({
        file: link.file,
        line: link.line,
        slug: link.slug,
        error: `Duplicate slug (conflicts with ${existing.file}:${existing.line})`,
      });
      continue;
    }

    slugMap.set(normalizedSlug, link);
  }

  // Report errors
  if (errors.length > 0) {
    console.error("❌ Validation failed:\n");
    for (const err of errors) {
      const location = err.line > 0 ? `${err.file}:${err.line}` : err.file;
      const slug = err.slug ? ` [${err.slug}]` : "";
      console.error(`   ${location}${slug}`);
      console.error(`   └─ ${err.error}\n`);
    }
    process.exit(1);
  }

  const validLinks = Array.from(slugMap.values());
  console.log(`✅ All ${validLinks.length} link(s) valid\n`);

  // Sync to KV and D1
  if (dryRun) {
    console.log("🔍 Dry run — skipping KV/D1 sync\n");
    console.log("Links that would be synced:");
    for (const link of validLinks) {
      console.log(`   ${link.slug} → ${link.url}`);
    }
  } else {
    console.log("☁️  Syncing to Cloudflare KV...\n");
    await syncToKV(validLinks);
    console.log(`✅ Synced ${validLinks.length} link(s) to KV\n`);

    console.log("☁️  Syncing to Cloudflare D1...\n");
    await syncToD1(validLinks);
    console.log(`✅ Synced ${validLinks.length} link(s) to D1\n`);
  }
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
