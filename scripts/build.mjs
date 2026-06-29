import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../', import.meta.url);
const sourceRoot = new URL('../src/', import.meta.url);
const outputRoot = new URL('../dist/', import.meta.url);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

async function compileTree(sourceUrl, destinationUrl) {
  for (const entry of await readdir(sourceUrl, { withFileTypes: true })) {
    const input = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, sourceUrl);
    const output = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name.replace(/\.ts$/u, '.js'), destinationUrl);
    if (entry.isDirectory()) {
      await mkdir(output, { recursive: true });
      await compileTree(input, output);
      continue;
    }
    if (extname(entry.name) !== '.ts' || entry.name.endsWith('.d.ts')) continue;
    let source = await readFile(input, 'utf8');
    let shebang = '';
    if (source.startsWith('#!')) {
      const newline = source.indexOf('\n');
      shebang = `${source.slice(0, newline)}\n`;
      source = source.slice(newline + 1);
    }
    const compiled = stripTypeScriptTypes(source, { mode: 'transform', sourceMap: false });
    await mkdir(new URL('./', output), { recursive: true });
    await writeFile(output, `${shebang}${compiled}`, 'utf8');
  }
}

await compileTree(sourceRoot, outputRoot);
await mkdir(new URL('../dist/ui/', import.meta.url), { recursive: true });
await cp(new URL('../ui/static/', import.meta.url), new URL('../dist/ui/', import.meta.url), { recursive: true });
await mkdir(new URL('../dist/ui/assets/', import.meta.url), { recursive: true });
await compileTree(new URL('../ui/src/', import.meta.url), new URL('../dist/ui/assets/', import.meta.url));
await chmod(new URL('../dist/cli/entry.js', import.meta.url), 0o755);
console.log('Built dependency-free TypeScript runtime.');
