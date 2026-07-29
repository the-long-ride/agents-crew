export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeTemplate(record) {
  const result = clone(record);
  result.config.template ??= { id: result.id || 'new-crew', name: result.name || 'New crew', description: '', layout: {} };
  result.config.template.layout ??= {};
  result.config.manager.alias ??= 'Manager';
  result.config.manager.model ??= 'configured-by-host';
  result.config.workers ??= [];
  result.config.workers = result.config.workers.map((worker, index) => ({
    enabled: true,
    priority: 50,
    roles: [],
    capabilities: ['read'],
    requires_network: false,
    requires_credentials: false,
    ...worker,
    alias: worker.alias || `Worker ${index + 1}`,
    model: worker.model || 'configured-by-user'
  }));
  return result;
}

export function nodeLayout(record) {
  const layout = record.config.template.layout || {};
  const managerPosition = layout.manager || { x: 72, y: 130 };
  const nodes = [{ id: 'manager', type: 'manager', x: managerPosition.x, y: managerPosition.y, data: record.config.manager }];
  record.config.workers.forEach((worker, index) => {
    const position = layout[worker.id] || { x: 430 + (index % 2) * 260, y: 70 + Math.floor(index / 2) * 190 };
    nodes.push({ id: worker.id, type: 'worker', index, x: position.x, y: position.y, data: worker });
  });
  return nodes;
}

export function addWorker(record) {
  const next = clone(record);
  const used = new Set(next.config.workers.map(worker => worker.id));
  let number = next.config.workers.length + 1;
  while (used.has(`worker-${number}`)) number += 1;
  next.config.workers.push({
    id: `worker-${number}`,
    alias: `Worker ${number}`,
    kind: 'cli',
    enabled: true,
    adapter: 'opencode',
    provider: null,
    host: null,
    model: 'configured-by-user',
    model_fallback: 'allow_host_default',
    roles: ['implementer'],
    capabilities: ['read', 'write', 'shell'],
    priority: 50,
    command: null,
    args: [],
    env_allowlist: [],
    api_base_url: null,
    api_key_env: null,
    headers: {},
    timeout_seconds: null,
    requires_network: true,
    requires_credentials: true
  });
  return next;
}

export function removeWorker(record, workerId) {
  const next = clone(record);
  next.config.workers = next.config.workers.filter(worker => worker.id !== workerId);
  return next;
}

export function savePayload(record, scope) {
  return { scope, config: record.config };
}
