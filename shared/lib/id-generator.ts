/**
 * Short & Unique ID Generator for CampusNav
 *
 * Generates clean, human-readable, collision-safe IDs using
 * short prefixes and 4-character alphanumeric codes (e.g. n-k4a2, e-7b9x, b-r3m1).
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function generateShortId(
  prefix: string,
  existingIds?: Set<string> | string[]
): string {
  const idSet = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  
  // Try 4-character code first
  for (let attempt = 0; attempt < 50; attempt++) {
    let rand = "";
    for (let i = 0; i < 4; i++) {
      rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    const candidate = `${prefix}-${rand}`;
    if (!idSet.has(candidate)) {
      return candidate;
    }
  }

  // 5-character fallback in dense environments
  for (let attempt = 0; attempt < 50; attempt++) {
    let rand = "";
    for (let i = 0; i < 5; i++) {
      rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    const candidate = `${prefix}-${rand}`;
    if (!idSet.has(candidate)) {
      return candidate;
    }
  }

  return `${prefix}-${Date.now().toString(36)}`;
}
