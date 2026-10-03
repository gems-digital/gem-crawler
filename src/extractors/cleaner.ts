import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';
import { htmlToCleanedMarkdown } from './markdown.js';
import type { RegisteredSource } from '../types/index.js';

export interface CleanResult {
  title: string;
  cleanedText: string;
  cleanedMarkdown: string;
  strategy: 'readability-linkedom' | 'domain-selector' | 'fallback';
  wordCount: number;
  characterCount: number;
}

/**
 * Extracts and cleans content from raw HTML using either domain-specific selectors
 * or Mozilla Readability algorithm with linkedom for generic blogs.
 */
export function cleanHtmlContent(rawHtml: string, sourceConfig?: RegisteredSource): CleanResult {
  if (!rawHtml || !rawHtml.trim()) {
    return {
      title: '',
      cleanedText: '',
      cleanedMarkdown: '',
      strategy: 'fallback',
      wordCount: 0,
      characterCount: 0,
    };
  }

  // 1. Try Domain-Specific Selectors first if defined in source registry
  if (sourceConfig?.selectors?.article) {
    try {
      const $ = cheerio.load(rawHtml);

      // Remove noise tags according to source rules
      if (sourceConfig.selectors.remove && sourceConfig.selectors.remove.length > 0) {
        for (const selector of sourceConfig.selectors.remove) {
          $(selector).remove();
        }
      }

      // Also remove universal non-content tags
      $('script, style, noscript, iframe, canvas, svg, nav, footer, header').remove();

      const articleNode = $(sourceConfig.selectors.article);
      if (articleNode.length > 0) {
        const articleHtml = articleNode.html() || '';
        const title = $('title').text().trim() || $('h1').first().text().trim() || '';
        const cleanedText = articleNode.text().replace(/\s+/g, ' ').trim();
        const cleanedMarkdown = htmlToCleanedMarkdown(articleHtml);

        const wordCount = cleanedText ? cleanedText.split(/\s+/).length : 0;

        return {
          title,
          cleanedText,
          cleanedMarkdown,
          strategy: 'domain-selector',
          wordCount,
          characterCount: cleanedText.length,
        };
      }
    } catch (err) {
      console.warn(`[Cleaner] Domain selector failed for ${sourceConfig.domain}, falling back to Readability:`, err);
    }
  }

  // 2. Generic extraction via Mozilla Readability + Linkedom
  try {
    const { document } = parseHTML(rawHtml);
    const reader = new Readability(document as unknown as Document, {
      charThreshold: 50,
      classesToPreserve: ['table', 'infobox', 'spec-table'],
    });

    const parsed = reader.parse();

    if (parsed && parsed.textContent && parsed.textContent.trim().length > 50) {
      const cleanedText = parsed.textContent.replace(/\s+/g, ' ').trim();
      const cleanedMarkdown = htmlToCleanedMarkdown(parsed.content || '');
      const wordCount = cleanedText.split(/\s+/).length;

      return {
        title: parsed.title || '',
        cleanedText,
        cleanedMarkdown,
        strategy: 'readability-linkedom',
        wordCount,
        characterCount: cleanedText.length,
      };
    }
  } catch (err) {
    console.warn('[Cleaner] Readability parse failed, falling back to simple Cheerio stripping:', err);
  }

  // 3. Fallback: Cheerio basic text stripping
  try {
    const $ = cheerio.load(rawHtml);
    $('script, style, noscript, iframe, canvas, svg, nav, footer, header').remove();
    const title = $('title').text().trim() || $('h1').first().text().trim() || '';
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const bodyHtml = $('body').html() || '';
    const cleanedMarkdown = htmlToCleanedMarkdown(bodyHtml);
    const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

    return {
      title,
      cleanedText: bodyText,
      cleanedMarkdown,
      strategy: 'fallback',
      wordCount,
      characterCount: bodyText.length,
    };
  } catch {
    return {
      title: '',
      cleanedText: '',
      cleanedMarkdown: '',
      strategy: 'fallback',
      wordCount: 0,
      characterCount: 0,
    };
  }
}
