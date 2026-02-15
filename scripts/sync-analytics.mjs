#!/usr/bin/env node

/**
 * Analytics Sync Script
 * 
 * Fetches click data from the analytics API and writes daily CSV files
 * to each user's folder. Per ADR-008.
 * 
 * Usage: node scripts/sync-analytics.mjs
 * 
 * Environment:
 *   ANALYTICS_API_URL - Base URL of the analytics API
 *   ANALYTICS_API_KEY - API key for authentication
 */

import { writeFile, mkdir, readFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const API_URL = process.env.ANALYTICS_API_URL || 'https://gitly.sh'
const API_KEY = process.env.ANALYTICS_API_KEY

if (!API_KEY) {
  console.error('Error: ANALYTICS_API_KEY environment variable is required')
  process.exit(1)
}

// Fetch clicks from the last 70 minutes (60 + 10 overlap buffer)
const BUFFER_MINUTES = 70
const now = Math.floor(Date.now() / 1000)
const since = now - (BUFFER_MINUTES * 60)

async function main() {
  console.log(`Fetching clicks from ${new Date(since * 1000).toISOString()} to ${new Date(now * 1000).toISOString()}`)
  
  // Fetch analytics data
  const response = await fetch(`${API_URL}/api/analytics?since=${since}&until=${now}`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    },
  })

  if (!response.ok) {
    console.error(`API error: ${response.status} ${response.statusText}`)
    const body = await response.text()
    console.error(body)
    process.exit(1)
  }

  const data = await response.json()
  console.log(`Fetched ${data.meta.count} clicks`)

  if (data.meta.count === 0) {
    console.log('No new clicks to process')
    return
  }

  // Group clicks by user and date
  const byUserAndDate = new Map()

  for (const click of data.clicks) {
    const date = new Date(click.clicked_at * 1000)
    const dateStr = date.toISOString().split('T')[0] // YYYY-MM-DD
    const [year, month, day] = dateStr.split('-')
    
    const user = click.created_by
    const key = `${user}/${year}/${month}/${day}`
    
    if (!byUserAndDate.has(key)) {
      byUserAndDate.set(key, {
        user,
        year,
        month,
        day,
        clicks: [],
      })
    }
    
    byUserAndDate.get(key).clicks.push(click)
  }

  // Write CSV files
  const csvHeader = 'clicked_at,slug,referrer,country,city,device_type,browser,os\n'
  
  for (const [key, { user, year, month, day, clicks }] of byUserAndDate) {
    const filePath = join('links', user, 'analytics', year, month, `${day}.csv`)
    const dirPath = dirname(filePath)
    
    // Ensure directory exists
    await mkdir(dirPath, { recursive: true })
    
    // Read existing file if it exists
    let existingContent = ''
    let existingLines = new Set()
    
    try {
      existingContent = await readFile(filePath, 'utf-8')
      // Track existing entries by timestamp+slug to avoid duplicates
      const lines = existingContent.trim().split('\n').slice(1) // Skip header
      for (const line of lines) {
        const [timestamp, slug] = line.split(',')
        existingLines.add(`${timestamp}:${slug}`)
      }
    } catch {
      // File doesn't exist yet
    }

    // Filter out duplicates and format new clicks
    const newRows = []
    for (const click of clicks) {
      const timestamp = new Date(click.clicked_at * 1000).toISOString()
      const key = `${timestamp}:${click.slug}`
      
      if (existingLines.has(key)) {
        continue // Skip duplicate
      }
      
      const row = [
        timestamp,
        click.slug,
        escapeCSV(click.referrer || ''),
        escapeCSV(click.country || ''),
        escapeCSV(click.city || ''),
        escapeCSV(click.device_type),
        escapeCSV(click.browser),
        escapeCSV(click.os),
      ].join(',')
      
      newRows.push(row)
    }

    if (newRows.length === 0) {
      console.log(`${filePath}: No new clicks (all duplicates)`)
      continue
    }

    // Write file
    if (existingContent) {
      // Append to existing
      const newContent = existingContent.trimEnd() + '\n' + newRows.join('\n') + '\n'
      await writeFile(filePath, newContent)
    } else {
      // New file with header
      await writeFile(filePath, csvHeader + newRows.join('\n') + '\n')
    }
    
    console.log(`${filePath}: Added ${newRows.length} clicks`)
  }
}

function escapeCSV(value) {
  if (value == null) return ''
  const str = String(value)
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

main().catch((err) => {
  console.error('Sync failed:', err)
  process.exit(1)
})
