import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type FetchLike = typeof fetch;

const REQUEST_OPTIONS: RequestInit = {
  redirect: 'follow',
  headers: { 'user-agent': 'agents-crew-installer' },
};

export async function downloadFile(
  url: string,
  destination: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const response = await fetchImpl(url, REQUEST_OPTIONS);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  await pipeline(
    Readable.fromWeb(response.body as never),
    createWriteStream(destination, { mode: 0o600 }),
  );
}

export async function downloadText(url: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const response = await fetchImpl(url, REQUEST_OPTIONS);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  return await response.text();
}
