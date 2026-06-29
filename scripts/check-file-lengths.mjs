#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export const limits = new Map([
  ['.ts', 400],
  ['.html', 500],
  ['.css', 600],
]);

const ignoredDirectories = new Set([
  '.agents-crew',
  '.cache',
  '.git',
  '.idea',
  '.vscode',
  '.worktrees',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);

export function countPhysicalLines(source) {
  if (source.length === 0) return 0;
  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n').length;
  return normalized.endsWith('\n') ? lines - 1 : lines;
}

export function collectViolations(root) {
  const absoluteRoot = resolve(root);
  const violations = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile()) continue;

      const limit = limits.get(extname(entry.name));
      if (limit === undefined) continue;
      const lines = countPhysicalLines(readFileSync(path, 'utf8'));
      if (lines <= limit) continue;
      violations.push({
        path: relative(absoluteRoot, path).replaceAll('\\', '/'),
        lines,
        limit,
      });
    }
  }

  visit(absoluteRoot);
  return violations.sort((left, right) => left.path.localeCompare(right.path));
}

export function formatViolations(violations) {
  const details = violations.map(
    ({ path, lines, limit }) => `- ${path}: ${lines} lines (limit ${limit})`,
  );
  return ['Source files exceed LOC limits:', ...details].join('\n');
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const violations = collectViolations(root);
  if (violations.length > 0) {
    console.error(formatViolations(violations));
    process.exitCode = 1;
    return;
  }
  console.log('Source file length lint passed.');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
