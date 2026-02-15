/**
 * Tests for safeFetch redirect chain handling
 * Run with: npx tsx safefetch-redirect.test.ts
 * 
 * These tests verify that:
 * 1. Redirect chains are fully followed (A→B→C reaches C)
 * 2. Each redirect in the chain is validated for SSRF
 * 3. Maximum redirect limit is enforced
 * 4. Redirects to internal addresses are blocked at any hop
 */

import { safeFetch } from './url-validator'

// Store the original fetch
const originalFetch = globalThis.fetch

// Track fetch calls for debugging
let fetchCalls: string[] = []

interface MockRoute {
  status: number
  location?: string
  body?: string
}

/**
 * Create a mock fetch that simulates redirect chains
 */
function mockFetch(routes: Record<string, MockRoute>) {
  fetchCalls = []
  
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    fetchCalls.push(url)
    
    const route = routes[url]
    if (!route) {
      throw new Error(`Unmocked URL: ${url}`)
    }
    
    const headers = new Headers()
    if (route.location) {
      headers.set('location', route.location)
    }
    
    return new Response(route.body || '', {
      status: route.status,
      headers,
    })
  }
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

// Test runner
interface TestCase {
  name: string
  run: () => Promise<void>
}

const tests: TestCase[] = []

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, run: fn })
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
      }
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
      }
    },
    toThrow(expectedMessage?: string) {
      // This is handled differently - see expectToThrow
    },
  }
}

async function expectToThrow(fn: () => Promise<unknown>, expectedMessage?: string) {
  try {
    await fn()
    throw new Error('Expected function to throw, but it did not')
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Expected function to throw, but it did not') {
        throw error
      }
      if (expectedMessage && !error.message.includes(expectedMessage)) {
        throw new Error(`Expected error containing "${expectedMessage}", got "${error.message}"`)
      }
    }
  }
}

// ============== TESTS ==============

test('follows a single redirect', async () => {
  mockFetch({
    'https://example.com/a': { status: 301, location: 'https://example.com/b' },
    'https://example.com/b': { status: 200, body: 'final' },
  })
  
  const response = await safeFetch('https://example.com/a')
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('final')
  expect(fetchCalls).toEqual(['https://example.com/a', 'https://example.com/b'])
  
  restoreFetch()
})

test('follows a chain of 3 redirects (A→B→C)', async () => {
  mockFetch({
    'https://example.com/a': { status: 301, location: 'https://example.com/b' },
    'https://example.com/b': { status: 302, location: 'https://example.com/c' },
    'https://example.com/c': { status: 200, body: 'final destination' },
  })
  
  const response = await safeFetch('https://example.com/a')
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('final destination')
  expect(fetchCalls).toEqual([
    'https://example.com/a',
    'https://example.com/b',
    'https://example.com/c',
  ])
  
  restoreFetch()
})

test('follows a chain of 5 redirects (max default)', async () => {
  mockFetch({
    'https://example.com/1': { status: 301, location: 'https://example.com/2' },
    'https://example.com/2': { status: 301, location: 'https://example.com/3' },
    'https://example.com/3': { status: 301, location: 'https://example.com/4' },
    'https://example.com/4': { status: 301, location: 'https://example.com/5' },
    'https://example.com/5': { status: 301, location: 'https://example.com/6' },
    'https://example.com/6': { status: 200, body: 'reached after 5 redirects' },
  })
  
  const response = await safeFetch('https://example.com/1')
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('reached after 5 redirects')
  
  restoreFetch()
})

test('throws when exceeding max redirects', async () => {
  mockFetch({
    'https://example.com/1': { status: 301, location: 'https://example.com/2' },
    'https://example.com/2': { status: 301, location: 'https://example.com/3' },
    'https://example.com/3': { status: 301, location: 'https://example.com/4' },
    'https://example.com/4': { status: 301, location: 'https://example.com/5' },
    'https://example.com/5': { status: 301, location: 'https://example.com/6' },
    'https://example.com/6': { status: 301, location: 'https://example.com/7' },
    'https://example.com/7': { status: 200, body: 'unreachable' },
  })
  
  await expectToThrow(
    () => safeFetch('https://example.com/1'),
    'Maximum redirects (5) exceeded'
  )
  
  restoreFetch()
})

test('respects custom maxRedirects option', async () => {
  mockFetch({
    'https://example.com/1': { status: 301, location: 'https://example.com/2' },
    'https://example.com/2': { status: 301, location: 'https://example.com/3' },
    'https://example.com/3': { status: 200, body: 'done' },
  })
  
  // Should fail with maxRedirects: 1
  await expectToThrow(
    () => safeFetch('https://example.com/1', { maxRedirects: 1 }),
    'Maximum redirects (1) exceeded'
  )
  
  restoreFetch()
})

test('blocks redirect to private IP mid-chain', async () => {
  mockFetch({
    'https://example.com/a': { status: 301, location: 'https://safe.com/b' },
    'https://safe.com/b': { status: 302, location: 'https://192.168.1.1/evil' },
  })
  
  await expectToThrow(
    () => safeFetch('https://example.com/a'),
    'Private IP addresses are not allowed'
  )
  
  restoreFetch()
})

test('blocks redirect to localhost mid-chain', async () => {
  mockFetch({
    'https://example.com/a': { status: 301, location: 'https://cdn.example.com/b' },
    'https://cdn.example.com/b': { status: 302, location: 'https://localhost/admin' },
  })
  
  await expectToThrow(
    () => safeFetch('https://example.com/a'),
    'Internal or metadata hostnames are not allowed'
  )
  
  restoreFetch()
})

test('blocks redirect to cloud metadata mid-chain', async () => {
  mockFetch({
    'https://example.com/start': { status: 301, location: 'https://attacker.com/redirect' },
    'https://attacker.com/redirect': { status: 302, location: 'https://169.254.169.254/latest/meta-data/' },
  })
  
  // Cloud metadata IPs are blocked - the exact error depends on which check catches it first
  await expectToThrow(
    () => safeFetch('https://example.com/start'),
    'not allowed'
  )
  
  restoreFetch()
})

test('handles relative redirect URLs', async () => {
  mockFetch({
    'https://example.com/path/a': { status: 301, location: '/path/b' },
    'https://example.com/path/b': { status: 302, location: '../other/c' },
    'https://example.com/other/c': { status: 200, body: 'relative redirect resolved' },
  })
  
  const response = await safeFetch('https://example.com/path/a')
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('relative redirect resolved')
  
  restoreFetch()
})

test('handles redirect chain across different domains', async () => {
  mockFetch({
    'https://shorturl.at/abc': { status: 301, location: 'https://bit.ly/xyz' },
    'https://bit.ly/xyz': { status: 302, location: 'https://final-destination.com/page' },
    'https://final-destination.com/page': { status: 200, body: 'cross-domain chain complete' },
  })
  
  const response = await safeFetch('https://shorturl.at/abc')
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('cross-domain chain complete')
  
  restoreFetch()
})

test('returns non-redirect response immediately', async () => {
  mockFetch({
    'https://example.com/direct': { status: 200, body: 'no redirect' },
  })
  
  const response = await safeFetch('https://example.com/direct')
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('no redirect')
  expect(fetchCalls).toEqual(['https://example.com/direct'])
  
  restoreFetch()
})

test('maxRedirects: 0 disables redirect following', async () => {
  mockFetch({
    'https://example.com/a': { status: 301, location: 'https://example.com/b' },
  })
  
  await expectToThrow(
    () => safeFetch('https://example.com/a', { maxRedirects: 0 }),
    'Maximum redirects (0) exceeded'
  )
  
  restoreFetch()
})

// ============== TEST RUNNER ==============

async function runTests() {
  console.log('Running safeFetch redirect chain tests...\n')
  
  let passed = 0
  let failed = 0
  
  for (const { name, run } of tests) {
    try {
      await run()
      console.log(`✓ ${name}`)
      passed++
    } catch (error) {
      console.log(`✗ ${name}`)
      console.log(`  Error: ${error instanceof Error ? error.message : error}`)
      failed++
    } finally {
      restoreFetch()
    }
  }
  
  console.log(`\n${passed} passed, ${failed} failed`)
  
  if (failed > 0) {
    process.exit(1)
  }
}

runTests()
