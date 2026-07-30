import type { CanvasEdge, CanvasNode, SaveTemplateRequest, TemplateRecord, WorkerConfig, WritableTemplateScope } from './types.js';

export function clone<T>(value: T): T { return structuredClone(value); }

function normalizedModel(value: string | undefined): string {
  const model = value?.trim() ?? '';
  return model === 'configured-by-host' || model === 'configured-by-user' ? '' : model;
}

export function normalizeTemplate(record: TemplateRecord): TemplateRecord {
  const result = clone(record);
  result.config.template ??= {
    id: result.id || 'new-crew',
    name: result.name || 'New crew',
    description: result.description || '',
    layout: {},
  };
  if (result.config.template.group || result.group) {
    const groupVal = result.config.template.group || result.group;
    result.group = groupVal;
    result.config.template.group = groupVal;
  }
  result.config.template.layout ??= {};
  result.config.manager.alias ??= 'Manager';
  result.config.manager.model = normalizedModel(result.config.manager.model);
  result.config.workers ??= [];
  result.config.workers = result.config.workers.map((worker, index) => ({
    ...worker,
    enabled: worker.enabled ?? true,
    priority: worker.priority ?? 50,
    roles: worker.roles ?? [],
    capabilities: worker.capabilities ?? ['read'],
    args: worker.args ?? [],
    env_allowlist: worker.env_allowlist ?? [],
    headers: worker.headers ?? {},
    requires_network: worker.requires_network ?? false,
    requires_credentials: worker.requires_credentials ?? false,
    alias: worker.alias || `Worker ${index + 1}`,
    model: normalizedModel(worker.model),
    model_fallback: worker.model_fallback ?? 'allow_host_default',
  }));
  return result;
}

export function nodeLayout(record: TemplateRecord): CanvasNode[] {
  const layout = record.config.template.layout ?? {};
  const managerPosition = layout.manager ?? { x: 72, y: 130 };
  const nodes: CanvasNode[] = [{
    id: 'manager', type: 'manager', x: managerPosition.x, y: managerPosition.y,
    data: record.config.manager,
  }];
  record.config.workers.forEach((worker, index) => {
    const position = layout[worker.id] ?? { x: 430 + (index % 2) * 260, y: 70 + Math.floor(index / 2) * 190 };
    nodes.push({ id: worker.id, type: 'worker', index, x: position.x, y: position.y, data: worker });
  });
  return nodes;
}

export function edgeLayout(nodes: CanvasNode[]): CanvasEdge[] {
  const manager = nodes[0];
  if (!manager) return [];
  return nodes.slice(1).map((node) => ({
    id: `manager-${node.id}`,
    x1: manager.x + 190,
    y1: manager.y + 54,
    x2: node.x,
    y2: node.y + 54,
  }));
}

export function addWorker(record: TemplateRecord): TemplateRecord {
  const next = clone(record);
  const used = new Set(next.config.workers.map((worker) => worker.id));
  let number = next.config.workers.length + 1;
  while (used.has(`worker-${number}`)) number += 1;
  const worker: WorkerConfig = {
    id: `worker-${number}`,
    alias: `Worker ${number}`,
    kind: 'cli',
    enabled: true,
    adapter: 'opencode',
    model: '',
    model_fallback: 'allow_host_default',
    roles: ['implementer'],
    capabilities: ['read', 'write', 'shell'],
    priority: 50,
    args: [],
    env_allowlist: [],
    headers: {},
    requires_network: true,
    requires_credentials: true,
  };
  next.config.workers.push(worker);
  return next;
}

export function removeWorker(record: TemplateRecord, workerId: string): TemplateRecord {
  const next = clone(record);
  next.config.workers = next.config.workers.filter((worker) => worker.id !== workerId);
  delete next.config.template.layout[workerId];
  return next;
}

export function savePayload(record: TemplateRecord, scope: WritableTemplateScope): SaveTemplateRequest {
  return { scope, config: clone(record.config) };
}
