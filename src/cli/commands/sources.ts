import { Command } from 'commander';
import { loadSourcesConfig } from '../../config/index.js';
import { cleanHtmlContent } from '../../extractors/cleaner.js';
import got from 'crawlee'; // got-scraping via crawlee

export function makeSourcesCommand(): Command {
  const cmd = new Command('sources');
  cmd.description('Quản lý và kiểm tra danh mục nguồn (Source Registry)');

  cmd
    .command('list')
    .description('Liệt kê danh sách tất cả các nguồn đăng ký theo tầng')
    .action(async () => {
      const sources = await loadSourcesConfig();
      console.log(`\n📚 Registered Sources (${sources.length} sources):`);
      console.log('--------------------------------------------------------------------------------');
      for (const s of sources) {
        console.log(`[Tier ${s.tier}] ${s.name.padEnd(35)} | Domain: ${s.domain.padEnd(25)} | Engine: ${s.engine || 'auto'}`);
      }
      console.log('--------------------------------------------------------------------------------\n');
    });

  cmd
    .command('test-url <url>')
    .description('Thử nghiệm bóc tách và làm sạch nội dung của 1 URL')
    .action(async (url: string) => {
      console.log(`\n🔍 Fetching & Testing extraction for: ${url}`);
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
          },
        });
        const html = await res.text();
        const sources = await loadSourcesConfig();
        const urlDomain = new URL(url).hostname;
        const matchedSource = sources.find((s) => s.domain === urlDomain);

        const result = cleanHtmlContent(html, matchedSource);
        console.log(`\n--- Extraction Results ---`);
        console.log(`Title    : ${result.title}`);
        console.log(`Strategy : ${result.strategy}`);
        console.log(`Words    : ${result.wordCount}`);
        console.log(`Chars    : ${result.characterCount}`);
        console.log(`\n--- Cleaned Text Sample (First 300 chars) ---`);
        console.log(result.cleanedText.slice(0, 300) + '...\n');
      } catch (err) {
        console.error(`❌ Failed to test URL:`, err);
      }
    });

  return cmd;
}
