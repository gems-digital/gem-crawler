#!/usr/bin/env node

import { Command } from 'commander';
import { makeCrawlCommand } from './cli/commands/crawl.js';
import { makeSourcesCommand } from './cli/commands/sources.js';
import { makeVerifyCommand } from './cli/commands/verify.js';
import { makeInspectCommand } from './cli/commands/inspect.js';
import { makeExportCommand } from './cli/commands/export.js';

const program = new Command();

program
  .name('gem-crawler')
  .description('OmniGem Knowledge Platform — Batch CLI Crawler & Archiver Tools')
  .version('1.0.0');

program.addCommand(makeCrawlCommand());
program.addCommand(makeSourcesCommand());
program.addCommand(makeVerifyCommand());
program.addCommand(makeInspectCommand());
program.addCommand(makeExportCommand());

program.parse(process.argv);
