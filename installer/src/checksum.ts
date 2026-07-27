import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function parseChecksumFile(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([a-fA-F0-9]{6,128})\s+[*]?(.+)$/);
    if (!match) throw new Error(`Invalid checksum line: ${rawLine}`);
    result.set(match[2], match[1].toLowerCase());
  }
  return result;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyChecksum(path: string, expected: string): Promise<void> {
  if (!/^[a-fA-F0-9]{64}$/.test(expected)) {
    throw new Error('Expected checksum must be a SHA-256 hex value');
  }
  const normalizedExpected = expected.toLowerCase();
  const actual = await sha256File(path);
  if (actual !== normalizedExpected) {
    throw new Error(`Checksum mismatch for ${path}: expected ${normalizedExpected}, received ${actual}`);
  }
}
