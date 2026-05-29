#!/usr/bin/env node
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(here, '..');
const target = resolve(process.env.CODEX_HOME ?? `${process.env.HOME}/.codex`, 'skills', 'divband-static-publishing');

await mkdir(dirname(target), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(skillRoot, target, {
  recursive: true,
  filter: (source) => !source.includes('/node_modules/') && !source.endsWith('/package.json'),
});
console.log(`Installed divband-static-publishing skill to ${target}`);
