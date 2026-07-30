import type { CanvasEdge, CanvasNode, SaveCrewRequest, CrewRecord, MemberConfig, WritableCrewScope } from './types.js';

export function clone<T>(value: T): T { return structuredClone(value); }

function normalizedModel(value: string | undefined): string {
  const model = value?.trim() ?? '';
  return model === 'configured-by-host' || model === 'configured-by-user' ? '' : model;
}

export function normalizeCrew(record: CrewRecord): CrewRecord {
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
  result.config.manager.alias ??= 'Boss';
  result.config.manager.model = normalizedModel(result.config.manager.model);
  result.config.workers ??= [];
  result.config.workers = result.config.workers.map((member, index) => ({
    ...member,
    enabled: member.enabled ?? true,
    priority: member.priority ?? 50,
    roles: member.roles ?? [],
    capabilities: member.capabilities ?? ['read'],
    args: member.args ?? [],
    env_allowlist: member.env_allowlist ?? [],
    headers: member.headers ?? {},
    requires_network: member.requires_network ?? false,
    requires_credentials: member.requires_credentials ?? false,
    alias: member.alias || `Member ${index + 1}`,
    model: normalizedModel(member.model),
    model_fallback: member.model_fallback ?? 'allow_host_default',
  }));
  return result;
}

export function nodeLayout(record: CrewRecord): CanvasNode[] {
  const layout = record.config.template.layout ?? {};
  const bossPosition = layout.boss ?? { x: 72, y: 130 };
  const nodes: CanvasNode[] = [{
    id: 'boss', type: 'boss', x: bossPosition.x, y: bossPosition.y,
    data: record.config.manager,
  }];
  record.config.workers.forEach((member, index) => {
    const position = layout[member.id] ?? { x: 430 + (index % 2) * 260, y: 70 + Math.floor(index / 2) * 190 };
    nodes.push({ id: member.id, type: 'member', index, x: position.x, y: position.y, data: member });
  });
  return nodes;
}

export function edgeLayout(nodes: CanvasNode[]): CanvasEdge[] {
  const boss = nodes[0];
  if (!boss) return [];
  return nodes.slice(1).map((node) => ({
    id: `boss-${node.id}`,
    x1: boss.x + 190,
    y1: boss.y + 54,
    x2: node.x,
    y2: node.y + 54,
  }));
}

export function addMember(record: CrewRecord): CrewRecord {
  const next = clone(record);
  const used = new Set(next.config.workers.map((member) => member.id));
  let number = next.config.workers.length + 1;
  while (used.has(`member-${number}`)) number += 1;
  const member: MemberConfig = {
    id: `member-${number}`,
    alias: `Member ${number}`,
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
  next.config.workers.push(member);
  return next;
}

export function removeMember(record: CrewRecord, memberId: string): CrewRecord {
  const next = clone(record);
  next.config.workers = next.config.workers.filter((member) => member.id !== memberId);
  delete next.config.template.layout[memberId];
  return next;
}

export function savePayload(record: CrewRecord, scope: WritableCrewScope): SaveCrewRequest {
  return { scope, config: clone(record.config) };
}