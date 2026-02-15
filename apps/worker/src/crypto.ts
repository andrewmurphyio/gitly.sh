/**
 * Cryptographic utilities for secure operations
 */

const encoder = new TextEncoder()

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses Web Crypto's timingSafeEqual when available (Cloudflare Workers),
 * falls back to a manual constant-time implementation.
 * 
 * @param a First string to compare
 * @param b Second string to compare
 * @returns true if strings are equal, false otherwise
 */
export async function constantTimeCompare(a: string, b: string): Promise<boolean> {
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)

  // Pad to same length to avoid length-based timing leaks
  const maxLen = Math.max(aBytes.length, bBytes.length)
  const aPadded = new Uint8Array(maxLen)
  const bPadded = new Uint8Array(maxLen)
  aPadded.set(aBytes)
  bPadded.set(bBytes)

  // Use crypto.subtle.timingSafeEqual if available (Cloudflare Workers)
  if (typeof crypto !== 'undefined' && crypto.subtle && 'timingSafeEqual' in crypto.subtle) {
    const isEqual = (crypto.subtle as any).timingSafeEqual(aPadded, bPadded)
    // Also check lengths match (padded comparison doesn't catch length mismatches)
    return isEqual && aBytes.length === bBytes.length
  }

  // Fallback: manual constant-time comparison
  let result = aBytes.length ^ bBytes.length // Will be non-zero if lengths differ
  for (let i = 0; i < maxLen; i++) {
    result |= aPadded[i] ^ bPadded[i]
  }
  return result === 0
}
