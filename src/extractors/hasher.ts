import crypto from 'node:crypto';

/**
 * Normalizes text content for deterministic SHA-256 change detection.
 * Removes formatting noise, whitespace variations, and normalizes Vietnamese Unicode (NFC).
 */
export function normalizeTextForHashing(text: string): string {
  if (!text) return '';

  return text
    .normalize('NFC')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .toLowerCase();
}

/**
 * Computes SHA-256 hash of normalized text.
 * Used to detect whether a web page content has materially changed across crawl runs.
 */
export function computeContentHash(cleanedText: string): string {
  const normalized = normalizeTextForHashing(cleanedText);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}
