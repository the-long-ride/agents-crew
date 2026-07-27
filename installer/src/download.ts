// @ts-nocheck
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'agents-crew-installer' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { mode: 0o600 }));
}

export async function downloadText(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'agents-crew-installer' },
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  return await response.text();
}
