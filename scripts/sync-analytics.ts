#!/usr/bin/env tsx

/**
 * Analytics Sync Script
 *
 * Fetches click data from the analytics API and writes daily CSV files
 * to each user's folder. Per ADR-008.
 *
 * Usage: pnpm --filter @gitly/scripts sync-analytics
 *
 * Environment:
 *   ANALYTICS_API_URL - Base URL of the analytics API
 *   ANALYTICS_API_KEY - API key for authentication
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Click {
  clicked_at: number;
  slug: string;
  referrer: string | null;
  country: string | null;
  city: string | null;
  device_type: string;
  browser: string;
  os: string;
  created_by: string;
}

interface AnalyticsResponse {
  meta: {
    count: number;
  };
  clicks: Click[];
}

interface GroupedClicks {
  user: string;
  year: string;
  month: string;
  day: string;
  clicks: Click[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

// Normalize API URL: strip trailing slashes and any /api suffix
// The script appends /api/analytics, so base URL should be just the domain
function normalizeApiUrl(url: string): string {
  let normalized = url.trim().replace(/\/+$/, ""); // Remove trailing slashes
  // If URL ends with /api, strip it (common misconfiguration)
  if (normalized.endsWith("/api")) {
    normalized = normalized.slice(0, -4);
  }
  return normalized;
}

const RAW_API_URL = process.env.ANALYTICS_API_URL || "https://gitly.sh";
const API_URL = normalizeApiUrl(RAW_API_URL);
const API_KEY = process.env.ANALYTICS_API_KEY;

if (!API_KEY) {
  console.error("Error: ANALYTICS_API_KEY environment variable is required");
  process.exit(1);
}

// Log normalized URL for debugging (only show domain)
const urlDomain = new URL(API_URL).hostname;
console.log(`Using API: ${urlDomain}`);

// Fetch clicks from the last 70 minutes (60 + 10 overlap buffer)
const BUFFER_MINUTES = 70;
const now = Math.floor(Date.now() / 1000);
const since = now - BUFFER_MINUTES * 60;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function escapeCSV(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `Fetching clicks from ${new Date(since * 1000).toISOString()} to ${new Date(now * 1000).toISOString()}`
  );

  // Fetch analytics data
  const endpoint = `${API_URL}/api/analytics?since=${since}&until=${now}`;
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  if (!response.ok) {
    console.error(`API error: ${response.status} ${response.statusText}`);
    console.error(`Endpoint: ${API_URL}/api/analytics`);
    const body = await response.text();
    console.error(body);
    
    // Provide helpful hints for common errors
    if (response.status === 404) {
      console.error("\nHint: 404 usually means ANALYTICS_API_URL is misconfigured.");
      console.error("Expected format: https://gitly.sh (just the domain, no /api suffix)");
    } else if (response.status === 401) {
      console.error("\nHint: 401 means ANALYTICS_API_KEY is invalid or missing.");
    }
    process.exit(1);
  }

  const data = (await response.json()) as AnalyticsResponse;
  console.log(`Fetched ${data.meta.count} clicks`);

  if (data.meta.count === 0) {
    console.log("No new clicks to process");
    return;
  }

  // Group clicks by user and date
  const byUserAndDate = new Map<string, GroupedClicks>();

  for (const click of data.clicks) {
    const date = new Date(click.clicked_at * 1000);
    const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
    const [year, month, day] = dateStr.split("-");

    const user = click.created_by;
    const key = `${user}/${year}/${month}/${day}`;

    if (!byUserAndDate.has(key)) {
      byUserAndDate.set(key, {
        user,
        year,
        month,
        day,
        clicks: [],
      });
    }

    byUserAndDate.get(key)!.clicks.push(click);
  }

  // Write CSV files
  const csvHeader =
    "clicked_at,slug,referrer,country,city,device_type,browser,os\n";

  // Track users who received new data (for total.csv regeneration)
  const usersWithNewData = new Set<string>();

  for (const [, { user, year, month, day, clicks }] of byUserAndDate) {
    const filePath = join("links", user, "analytics", year, month, `${day}.csv`);
    const dirPath = dirname(filePath);

    // Ensure directory exists
    await mkdir(dirPath, { recursive: true });

    // Read existing file if it exists
    let existingContent = "";
    const existingLines = new Set<string>();

    try {
      existingContent = await readFile(filePath, "utf-8");
      // Track existing entries by timestamp+slug to avoid duplicates
      const lines = existingContent.trim().split("\n").slice(1); // Skip header
      for (const line of lines) {
        const [timestamp, slug] = line.split(",");
        existingLines.add(`${timestamp}:${slug}`);
      }
    } catch {
      // File doesn't exist yet
    }

    // Filter out duplicates and format new clicks
    const newRows: string[] = [];
    for (const click of clicks) {
      const timestamp = new Date(click.clicked_at * 1000).toISOString();
      const dedupeKey = `${timestamp}:${click.slug}`;

      if (existingLines.has(dedupeKey)) {
        continue; // Skip duplicate
      }

      const row = [
        timestamp,
        click.slug,
        escapeCSV(click.referrer),
        escapeCSV(click.country),
        escapeCSV(click.city),
        escapeCSV(click.device_type),
        escapeCSV(click.browser),
        escapeCSV(click.os),
      ].join(",");

      newRows.push(row);
    }

    if (newRows.length === 0) {
      console.log(`${filePath}: No new clicks (all duplicates)`);
      continue;
    }

    // Write file
    if (existingContent) {
      // Append to existing
      const newContent =
        existingContent.trimEnd() + "\n" + newRows.join("\n") + "\n";
      await writeFile(filePath, newContent);
    } else {
      // New file with header
      await writeFile(filePath, csvHeader + newRows.join("\n") + "\n");
    }

    console.log(`${filePath}: Added ${newRows.length} clicks`);
    usersWithNewData.add(user);
  }

  // Regenerate total.csv for users who received new data
  for (const user of usersWithNewData) {
    await generateTotalCsv(user);
  }
}

/**
 * Generate total.csv by aggregating all clicks from daily CSVs.
 * Format: slug,clicks (sorted by clicks descending)
 */
async function generateTotalCsv(user: string): Promise<void> {
  const analyticsDir = join("links", user, "analytics");
  const totalPath = join(analyticsDir, "total.csv");

  // Aggregate clicks by slug
  const slugCounts = new Map<string, number>();

  // Recursively find all daily CSV files
  const dailyFiles = await findDailyCsvFiles(analyticsDir);

  for (const filePath of dailyFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").slice(1); // Skip header

      for (const line of lines) {
        if (!line.trim()) continue;
        // CSV format: clicked_at,slug,...
        const [, slug] = line.split(",");
        if (slug) {
          slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  if (slugCounts.size === 0) {
    console.log(`${totalPath}: No clicks to aggregate`);
    return;
  }

  // Sort by clicks descending
  const sorted = [...slugCounts.entries()].sort((a, b) => b[1] - a[1]);

  // Write total.csv
  const header = "slug,clicks\n";
  const rows = sorted.map(([slug, count]) => `${slug},${count}`).join("\n");
  await writeFile(totalPath, header + rows + "\n");

  console.log(`${totalPath}: Aggregated ${slugCounts.size} slugs`);
}

/**
 * Recursively find all daily CSV files in the analytics directory.
 * Pattern: {year}/{month}/{day}.csv
 */
async function findDailyCsvFiles(dir: string): Promise<string[]> {
  const { readdir, stat } = await import("node:fs/promises");
  const files: string[] = [];

  try {
    const entries = await readdir(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      try {
        const info = await stat(fullPath);

        if (info.isDirectory()) {
          // Recurse into year/month directories
          const nested = await findDailyCsvFiles(fullPath);
          files.push(...nested);
        } else if (entry.endsWith(".csv") && entry !== "total.csv") {
          // Daily CSV file (e.g., 15.csv)
          files.push(fullPath);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  } catch {
    // Directory doesn't exist or is inaccessible
  }

  return files;
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
