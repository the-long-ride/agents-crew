// @ts-nocheck
import { mkdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { runCommand } from './process.js';

export function assertSafeArchiveEntries(entries: string[]): void {
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    const segments = normalized.split('/').filter(Boolean);
    const unsafe = !normalized || isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || segments.includes('..');
    if (unsafe) throw new Error(`Unsafe archive entry: ${entry}`);
  }
}

async function listZipEntries(archivePath: string): Promise<string[]> {
  const script = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    '$archive = [System.IO.Compression.ZipFile]::OpenRead($env:AGENTS_CREW_ARCHIVE);',
    'try { $archive.Entries | ForEach-Object { $_.FullName } } finally { $archive.Dispose() }',
  ].join(' ');
  const result = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    quiet: true,
    env: { AGENTS_CREW_ARCHIVE: archivePath },
  });
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

async function extractZip(archivePath: string, destination: string): Promise<void> {
  const script = 'Expand-Archive -LiteralPath $env:AGENTS_CREW_ARCHIVE -DestinationPath $env:AGENTS_CREW_DESTINATION -Force';
  await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    quiet: true,
    env: {
      AGENTS_CREW_ARCHIVE: archivePath,
      AGENTS_CREW_DESTINATION: destination,
    },
  });
}

export async function extractArchive(archivePath: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  if (archivePath.toLowerCase().endsWith('.zip')) {
    const entries = await listZipEntries(archivePath);
    assertSafeArchiveEntries(entries);
    await extractZip(archivePath, destination);
    return;
  }
  const listing = await runCommand('tar', ['-tf', archivePath], { quiet: true });
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
  assertSafeArchiveEntries(entries);
  await runCommand('tar', ['-xf', archivePath, '-C', destination], { quiet: true });
}
