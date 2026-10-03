import TurndownService from 'turndown';
// @ts-expect-error turndown-plugin-gfm doesn't have official TS types in some versions
import { gfm } from 'turndown-plugin-gfm';

let turndownInstance: TurndownService | null = null;

export function getTurndownService(): TurndownService {
  if (turndownInstance) return turndownInstance;

  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });

  // Enable GFM plugin for GitHub-flavored tables, strikethrough, task lists
  try {
    service.use(gfm);
  } catch (err) {
    console.warn('[Turndown] GFM plugin could not be loaded, using standard markdown formatting:', err);
  }

  // Remove useless or empty tags
  service.remove(['script', 'style', 'noscript', 'iframe', 'canvas'] as (keyof HTMLElementTagNameMap)[]);
  service.addRule('removeSvg', {
    filter: (node) => node.nodeName.toLowerCase() === 'svg',
    replacement: () => '',
  });

  turndownInstance = service;
  return service;
}

/**
 * Converts cleaned HTML content into well-structured Markdown, preserving tables and lists.
 */
export function htmlToCleanedMarkdown(html: string): string {
  if (!html || !html.trim()) return '';
  const service = getTurndownService();
  return service.turndown(html).trim();
}
