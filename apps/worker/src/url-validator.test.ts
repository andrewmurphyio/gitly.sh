/**
 * Unit tests for URL validation
 * Run with: npx tsx url-validator.test.ts
 */

import { validateUrlForFetch } from './url-validator'

const testCases: Array<{
  url: string
  shouldPass: boolean
  description: string
}> = [
  // Valid URLs
  { url: 'https://example.com/logo.png', shouldPass: true, description: 'Valid HTTPS URL' },
  { url: 'https://cdn.github.com/image.png', shouldPass: true, description: 'Valid CDN URL' },
  { url: 'https://raw.githubusercontent.com/user/repo/main/logo.png', shouldPass: true, description: 'GitHub raw URL' },
  
  // Protocol validation
  { url: 'http://example.com/logo.png', shouldPass: false, description: 'HTTP rejected (not HTTPS)' },
  { url: 'ftp://example.com/logo.png', shouldPass: false, description: 'FTP rejected' },
  { url: 'file:///etc/passwd', shouldPass: false, description: 'File protocol rejected' },
  
  // Localhost variants
  { url: 'https://localhost/logo.png', shouldPass: false, description: 'localhost blocked' },
  { url: 'https://localhost:8080/logo.png', shouldPass: false, description: 'localhost with port blocked' },
  { url: 'https://127.0.0.1/logo.png', shouldPass: false, description: 'IPv4 loopback blocked' },
  { url: 'https://[::1]/logo.png', shouldPass: false, description: 'IPv6 loopback blocked' },
  
  // Private IP ranges
  { url: 'https://10.0.0.1/logo.png', shouldPass: false, description: '10.x.x.x blocked' },
  { url: 'https://172.16.0.1/logo.png', shouldPass: false, description: '172.16.x.x blocked' },
  { url: 'https://192.168.1.1/logo.png', shouldPass: false, description: '192.168.x.x blocked' },
  
  // Cloud metadata
  { url: 'https://169.254.169.254/latest/meta-data/', shouldPass: false, description: 'AWS metadata blocked' },
  { url: 'https://169.254.170.2/latest/meta-data/', shouldPass: false, description: 'AWS ECS metadata blocked' },
  
  // Internal TLDs
  { url: 'https://server.local/logo.png', shouldPass: false, description: '.local TLD blocked' },
  { url: 'https://app.internal/logo.png', shouldPass: false, description: '.internal TLD blocked' },
  { url: 'https://host.corp/logo.png', shouldPass: false, description: '.corp TLD blocked' },
  
  // Numeric IP tricks
  { url: 'https://2130706433/logo.png', shouldPass: false, description: 'Decimal IP notation blocked' },
  { url: 'https://0x7f000001/logo.png', shouldPass: false, description: 'Hex IP notation blocked' },
  
  // URL with credentials
  { url: 'https://user:pass@example.com/logo.png', shouldPass: false, description: 'URL with credentials blocked' },
  
  // IPv6 private ranges
  { url: 'https://[fc00::1]/logo.png', shouldPass: false, description: 'IPv6 unique local blocked' },
  { url: 'https://[fd00::1]/logo.png', shouldPass: false, description: 'IPv6 unique local blocked' },
  { url: 'https://[fe80::1]/logo.png', shouldPass: false, description: 'IPv6 link-local blocked' },
  
  // IPv4-mapped IPv6
  { url: 'https://[::ffff:127.0.0.1]/logo.png', shouldPass: false, description: 'IPv4-mapped IPv6 loopback blocked' },
  { url: 'https://[::ffff:192.168.1.1]/logo.png', shouldPass: false, description: 'IPv4-mapped IPv6 private blocked' },
]

let passed = 0
let failed = 0

console.log('Running URL validation tests...\n')

for (const { url, shouldPass, description } of testCases) {
  const result = validateUrlForFetch(url)
  const actualPass = result.valid
  
  if (actualPass === shouldPass) {
    console.log(`✓ ${description}`)
    passed++
  } else {
    console.log(`✗ ${description}`)
    console.log(`  URL: ${url}`)
    console.log(`  Expected: ${shouldPass ? 'pass' : 'fail'}`)
    console.log(`  Actual: ${actualPass ? 'pass' : `fail (${result.error})`}`)
    failed++
  }
}

console.log(`\n${passed} passed, ${failed} failed`)

if (failed > 0) {
  process.exit(1)
}
