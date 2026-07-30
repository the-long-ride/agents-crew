import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const endpoint = 'https://models.dev/api.json';
const maxCacheAgeMs = 6 * 60 * 60 * 1000;

export interface ModelSuggestion {
  id: string;
  name: string;
  provider: string;
  context?: number;
  reasoning: boolean;
  tool_call: boolean;
  attachment: boolean;
}

export interface ModelCatalogResponse {
  host: string;
  providers: string[];
  models: ModelSuggestion[];
  source: 'live' | 'cache' | 'stale' | 'unavailable' | 'none';
  stale: boolean;
  fetched_at?: string;
  error?: string;
}

type ProviderModels = Record<string, ModelSuggestion[]>;
interface CacheDocument { schema_version: 2; fetched_at: number; providers: ProviderModels }
type CatalogFetcher = () => Promise<unknown>;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function optionalBoolean(value: unknown): boolean { return value === true; }
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
function isTextLlm(model: Record<string, unknown>): boolean {
  const modalities = object(model.modalities);
  const input = stringArray(modalities?.input);
  const output = stringArray(modalities?.output);
  return input.includes('text') && output.includes('text');
}
function optionalPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

export function modelProvidersForHost(host: string): string[] {
  const normalized = host.trim().toLowerCase();
  if (normalized === 'codex' || normalized === 'openai') return ['openai'];
  if (normalized === 'claude-code' || normalized === 'claude' || normalized === 'anthropic') return ['anthropic'];
  if (normalized === 'google') return ['google'];
  if (normalized === 'antigravity') return ['google', 'anthropic'];
  if (normalized === 'opencode') return ['*'];
  return [];
}

export function normalizeModelsDev(value: unknown): ProviderModels {
  const root = object(value);
  if (!root) throw new Error('invalid Models.dev catalog: root must be an object');
  const providers: ProviderModels = {};
  let providerCount = 0;
  for (const [providerId, rawProvider] of Object.entries(root)) {
    const provider = object(rawProvider);
    if (!provider) continue;
    const rawModels = object(provider.models);
    if (!rawModels) {
      if (['openai', 'anthropic', 'google'].includes(providerId)) {
        throw new Error(`invalid Models.dev catalog: provider ${providerId} has no model map`);
      }
      continue;
    }
    providerCount += 1;
    const models: ModelSuggestion[] = [];
    for (const [mapId, rawModel] of Object.entries(rawModels)) {
      const model = object(rawModel);
      if (!model || model.status === 'deprecated' || !isTextLlm(model)) continue;
      const id = typeof model.id === 'string' && model.id.trim() ? model.id.trim() : mapId;
      const name = typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id;
      const limit = object(model.limit);
      const suggestion: ModelSuggestion = {
        id,
        name,
        provider: providerId,
        reasoning: optionalBoolean(model.reasoning),
        tool_call: optionalBoolean(model.tool_call),
        attachment: optionalBoolean(model.attachment),
      };
      const context = optionalPositiveInteger(limit?.context);
      if (context !== undefined) suggestion.context = context;
      models.push(suggestion);
    }
    providers[providerId] = models.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }
  if (providerCount === 0) throw new Error('invalid Models.dev catalog: no providers found');
  return providers;
}

function validCache(value: unknown): CacheDocument | undefined {
  const document = object(value);
  if (!document || document.schema_version !== 2 || !Number.isFinite(document.fetched_at)) return undefined;
  const rawProviders = object(document.providers);
  if (!rawProviders) return undefined;
  const providers: ProviderModels = {};
  for (const [provider, rawModels] of Object.entries(rawProviders)) {
    if (!Array.isArray(rawModels)) return undefined;
    const models: ModelSuggestion[] = [];
    for (const rawModel of rawModels) {
      const model = object(rawModel);
      if (!model || typeof model.id !== 'string' || typeof model.name !== 'string' || typeof model.provider !== 'string') return undefined;
      models.push({
        id: model.id,
        name: model.name,
        provider: model.provider,
        reasoning: model.reasoning === true,
        tool_call: model.tool_call === true,
        attachment: model.attachment === true,
        ...(optionalPositiveInteger(model.context) !== undefined ? { context: Number(model.context) } : {}),
      });
    }
    providers[provider] = models;
  }
  return { schema_version: 2, fetched_at: Number(document.fetched_at), providers };
}

async function defaultFetcher(): Promise<unknown> {
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Models.dev request failed with HTTP ${response.status}`);
  return response.json();
}

export class ModelCatalog {
  readonly cachePath: string;

  constructor(
    readonly workspace: string,
    readonly fetcher: CatalogFetcher = defaultFetcher,
    readonly now: () => number = Date.now,
  ) {
    this.cachePath = join(workspace, '.agents-crew', 'cache', 'models-dev.json');
  }

  private async readCache(): Promise<CacheDocument | undefined> {
    if (!existsSync(this.cachePath)) return undefined;
    try { return validCache(JSON.parse(await readFile(this.cachePath, 'utf8'))); }
    catch { return undefined; }
  }

  private async saveCache(cache: CacheDocument): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true });
    const temporary = `${this.cachePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    await rename(temporary, this.cachePath);
  }

  private response(host: string, providers: string[], cache: CacheDocument, source: ModelCatalogResponse['source'], error?: string): ModelCatalogResponse {
    const resolvedProviders = providers.includes('*') ? Object.keys(cache.providers).sort() : providers;
    const models = resolvedProviders.flatMap((provider) => cache.providers[provider] ?? []);
    const result: ModelCatalogResponse = {
      host,
      providers: resolvedProviders,
      models,
      source,
      stale: source === 'stale',
      fetched_at: new Date(cache.fetched_at).toISOString(),
    };
    if (error) result.error = error;
    return result;
  }

  async list(host: string, refresh = false): Promise<ModelCatalogResponse> {
    const providers = modelProvidersForHost(host);
    if (providers.length === 0) return { host, providers, models: [], source: 'none', stale: false };
    const cached = await this.readCache();
    if (!refresh && cached && this.now() - cached.fetched_at < maxCacheAgeMs) {
      return this.response(host, providers, cached, 'cache');
    }
    try {
      const live: CacheDocument = { schema_version: 2, fetched_at: this.now(), providers: normalizeModelsDev(await this.fetcher()) };
      await this.saveCache(live);
      return this.response(host, providers, live, 'live');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cached) return this.response(host, providers, cached, 'stale', message);
      return { host, providers, models: [], source: 'unavailable', stale: true, error: message };
    }
  }
}
