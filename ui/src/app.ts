import { requestJson } from './api.js';
import { modelIsAvailable, mountBuilder } from './builder.js';
import { mountCombobox } from './components/combobox.js';
import { confirmDialog, promptDialog } from './components/dialog.js';
import { mountInfoPopovers } from './components/info.js';
import { mountSidebarResizers } from './components/sidebar-resizer.js';
import { byId } from './dom.js';
import { resetViewport } from './graph/viewport.js';
import { addWorker, normalizeTemplate, removeWorker, savePayload } from './model.js';
import { renderRunView } from './runtime.js';
import { renderTemplates } from './templates.js';
import { mountThemeToggle } from './theme.js';
import type {
  AppState,
  BootstrapResponse,
  ModelCatalogResponse,
  RunDetail,
  RunSummary,
  TemplateRecord,
  ViewName,
  WorkerConfig,
} from './types.js';

const state: AppState = {
  templates: [],
  runs: [],
  historyRuns: [],
  roles: [],
  capabilities: [],
  models: [],
  modelCatalogs: {},
  current: null,
  selected: null,
  selectedRunId: null,
  runDetail: null,
  selectedHistoryRunId: null,
  historyDetail: null,
  viewport: resetViewport(),
  view: 'builder',
  search: '',
  saveScope: 'global',
  groups: [],
  collapsedGroups: [],
};

const GROUPS_STORAGE_KEY = 'agents-crew-template-groups';

function readStoredGroups(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(GROUPS_STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  } catch { return []; }
}

function storeGroups(): void {
  try { window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(state.groups)); } catch { /* storage unavailable */ }
}

state.groups = readStoredGroups();

let toastTimer: number | undefined;
function toast(message: string): void {
  const node = byId<HTMLDivElement>('toast');
  node.textContent = message;
  node.classList.add('show');
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove('show'), 2800);
}

function selectTemplate(record: TemplateRecord): void {
  state.current = normalizeTemplate(record);
  state.selected = null;
  state.viewport = resetViewport();
  render();
}

function setView(view: ViewName): void {
  state.view = view;
  render();
}

function newTemplate(): void {
  const source = state.templates.find((item) => item.id === 'default') ?? state.templates[0];
  if (!source) { toast('No source template available'); return; }
  const next = normalizeTemplate(source);
  const id = `crew-${Date.now().toString(36)}`;
  next.id = id;
  next.name = 'New crew';
  next.description = '';
  next.scope = state.saveScope;
  delete next.path;
  next.config.template = { id, name: 'New crew', description: '', layout: {} };
  state.current = next;
  state.selected = null;
  state.viewport = resetViewport();
  setView('builder');
}

async function newGroup(): Promise<void> {
  const groupName = await promptDialog({
    title: 'New Group',
    message: 'Enter group name for organizing templates:',
    placeholder: 'e.g. Workflows, Development, Testing',
  });
  if (!groupName) return;
  if (!state.groups.includes(groupName)) {
    state.groups.push(groupName);
    storeGroups();
  }
  toast(`Group "${groupName}" created`);
  render();
}

function deleteGroup(groupName: string): void {
  const count = state.templates.filter((t) => (t.config.template?.group || t.group) === groupName).length
    + (state.current && !state.templates.some((t) => t.id === state.current?.id && t.scope === state.current?.scope)
      && (state.current.config.template?.group || state.current.group) === groupName ? 1 : 0);
  if (count > 0) {
    toast(`Cannot delete group "${groupName}" because it contains ${count} template(s)`);
    return;
  }
  state.groups = (state.groups || []).filter((g) => g !== groupName);
  storeGroups();
  state.collapsedGroups = (state.collapsedGroups || []).filter((g) => g !== groupName);
  toast(`Group "${groupName}" deleted`);
  render();
}

function addWorkerToCurrent(): void {
  if (!state.current) return;
  state.current = addWorker(state.current);
  render();
}

function deleteSelected(): void {
  if (!state.current || state.selected?.type !== 'worker') return;
  state.current = removeWorker(state.current, state.selected.id);
  state.selected = null;
  render();
}


function workerAdapter(worker: WorkerConfig): string {
  return worker.adapter ?? worker.provider ?? worker.host ?? worker.kind;
}

async function validateCurrentModels(record: TemplateRecord): Promise<string | undefined> {
  const entries = [
    { label: 'Manager', adapter: record.config.manager.host, model: record.config.manager.model },
    ...record.config.workers.map((worker) => ({
      label: worker.alias || worker.id,
      adapter: workerAdapter(worker),
      model: worker.model,
    })),
  ];
  for (const entry of entries) {
    const model = entry.model?.trim() ?? '';
    if (!model) continue;
    const catalog = await loadModels(entry.adapter);
    if (!modelIsAvailable(entry.adapter, model, catalog)) {
      return `${entry.label}: choose a current model for ${entry.adapter}`;
    }
  }
  return undefined;
}

async function saveCurrent(): Promise<void> {
  if (!state.current) return;
  const metadata = state.current.config.template;
  metadata.name = metadata.name.trim();
  metadata.id = metadata.id.trim();
  if (!metadata.name) { toast('Template name is required'); return; }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(metadata.id)) {
    toast('Template ID must be a lowercase slug');
    return;
  }
  const previous = { id: state.current.id, scope: state.current.scope, path: state.current.path };
  try {
    const invalidModel = await validateCurrentModels(state.current);
    if (invalidModel) { toast(invalidModel); return; }
    const saved = await requestJson<TemplateRecord>(`/api/templates/${encodeURIComponent(metadata.id)}`, {
      method: 'PUT', body: JSON.stringify(savePayload(state.current, state.saveScope)),
    });
    let cleanupFailed = false;
    if (previous.path && previous.scope !== 'builtin' && (previous.id !== saved.id || previous.scope !== saved.scope)) {
      try {
        await requestJson(`/api/templates/${encodeURIComponent(previous.id)}?scope=${encodeURIComponent(previous.scope)}`, { method: 'DELETE' });
      } catch { cleanupFailed = true; }
    }
    state.templates = await requestJson<TemplateRecord[]>('/api/templates');
    state.current = normalizeTemplate(saved);
    state.selected = null;
    toast(cleanupFailed ? 'Template saved; old template could not be removed' : 'Template saved');
    render();
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
}

async function deleteTemplate(record: TemplateRecord | null = state.current): Promise<void> {
  if (!record || record.scope === 'builtin' || !record.path) return;
  const confirmed = await confirmDialog({
    title: 'Delete template',
    message: `Are you sure you want to delete template "${record.name}" (${record.scope})? This action cannot be undone.`,
    confirmText: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;
  try {
    await requestJson(`/api/templates/${encodeURIComponent(record.id)}?scope=${encodeURIComponent(record.scope)}`, { method: 'DELETE' });
    state.templates = await requestJson<TemplateRecord[]>('/api/templates');
    if (state.current?.id === record.id && state.current.scope === record.scope) {
      const replacement = state.templates.find((item) => item.id === record.id) ?? state.templates[0];
      state.current = replacement ? normalizeTemplate(replacement) : null;
      state.selected = null;
      state.viewport = resetViewport();
    }
    toast('Template deleted');
    render();
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
}

async function moveTemplateGroup(record: TemplateRecord, group: string | undefined): Promise<boolean> {
  if (record.scope === 'builtin' || !record.path) {
    toast('Built-in templates cannot be reassigned');
    return false;
  }
  const config = structuredClone(record.config);
  config.template.group = group;
  try {
    await requestJson<TemplateRecord>(`/api/templates/${encodeURIComponent(record.id)}`, {
      method: 'PUT', body: JSON.stringify({ scope: record.scope, config }),
    });
    state.templates = await requestJson<TemplateRecord[]>('/api/templates');
    if (state.current?.id === record.id && state.current.scope === record.scope) {
      state.current = normalizeTemplate(state.templates.find((item) => item.id === record.id && item.scope === record.scope) ?? record);
    }
    render();
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
    return false;
  }
}

const modelRequests = new Map<string, Promise<ModelCatalogResponse>>();
async function loadModels(host: string, refresh = false): Promise<ModelCatalogResponse> {
  const key = host.trim().toLowerCase();
  const cached = state.modelCatalogs[key];
  if (!refresh && cached) return cached;
  const existing = modelRequests.get(key);
  if (!refresh && existing) return existing;
  const request = requestJson<ModelCatalogResponse>(`/api/models?host=${encodeURIComponent(key)}${refresh ? '&refresh=1' : ''}`)
    .then((result) => { state.modelCatalogs[key] = result; return result; })
    .finally(() => modelRequests.delete(key));
  modelRequests.set(key, request);
  return request;
}

async function refreshRuns(): Promise<void> {
  try {
    const [active, history] = await Promise.all([
      requestJson<{ runs: RunSummary[] }>('/api/runs?archived=active'),
      requestJson<{ runs: RunSummary[] }>('/api/runs?archived=history'),
    ]);
    state.runs = active.runs;
    state.historyRuns = history.runs;
    if (state.selectedRunId && !state.runs.some((run) => run.id === state.selectedRunId)) {
      state.selectedRunId = null;
      state.runDetail = null;
    }
    if (state.selectedHistoryRunId && !state.historyRuns.some((run) => run.id === state.selectedHistoryRunId)) {
      state.selectedHistoryRunId = null;
      state.historyDetail = null;
    }
    renderRunViews();
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
}

async function loadRun(id: string, history: boolean): Promise<void> {
  try {
    const detail = await requestJson<RunDetail>(`/api/runs/${encodeURIComponent(id)}`);
    if (history) { state.selectedHistoryRunId = id; state.historyDetail = detail; }
    else { state.selectedRunId = id; state.runDetail = detail; }
    renderRunViews();
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
}

async function controlRun(action: 'pause' | 'resume' | 'cancel'): Promise<void> {
  if (!state.selectedRunId) return;
  try {
    state.runDetail = await requestJson<RunDetail>(`/api/runs/${encodeURIComponent(state.selectedRunId)}/${action}`, {
      method: 'POST', body: '{}',
    });
    await refreshRuns();
    toast(`Run ${action === 'cancel' ? 'cancelled' : `${action}d`}`);
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
}

const renderBuilderView = mountBuilder(state, {
  selectTemplate,
  newTemplate,
  newGroup: () => void newGroup(),
  deleteGroup,
  addWorker: addWorkerToCurrent,
  saveTemplate: () => void saveCurrent(),
  deleteTemplate: (record) => void deleteTemplate(record),
  moveTemplateGroup,
  deleteSelected,
  loadModels,
});
const runtimeActions = { loadRun, controlRun };

function renderRunViews(): void {
  renderRunView({
    listId: 'run-list', detailId: 'run-detail', runs: state.runs,
    selectedId: state.selectedRunId, detail: state.runDetail, history: false, actions: runtimeActions,
  });
  renderRunView({
    listId: 'history-list', detailId: 'history-detail', runs: state.historyRuns,
    selectedId: state.selectedHistoryRunId, detail: state.historyDetail, history: true, actions: runtimeActions,
  });
}

const scopeControl = mountCombobox(byId('save-scope-control'), {
  id: 'save-scope', value: 'global', searchable: false, displayLabel: true,
  options: [
    { value: 'global', label: 'Global', description: 'Available in every workspace' },
    { value: 'workspace', label: 'Workspace', description: 'Only this repository' },
  ],
  onChange(value) { state.saveScope = value === 'workspace' ? 'workspace' : 'global'; },
});
mountThemeToggle();
mountInfoPopovers();
mountSidebarResizers(byId('builder-view'));

function render(): void {
  for (const view of ['builder', 'templates', 'runtime', 'history'] as ViewName[]) {
    byId(`${view}-view`).hidden = state.view !== view;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.classList.toggle('active', button.dataset.view === state.view);
  }
  scopeControl.setValue(state.saveScope);
  renderBuilderView();
  renderTemplates(state, {
    open(record) { selectTemplate(record); setView('builder'); },
    delete(record) { void deleteTemplate(record); },
  });
  renderRunViews();
}

async function initialize(): Promise<void> {
  try {
    const bootstrap = await requestJson<BootstrapResponse>('/api/bootstrap');
    state.templates = bootstrap.templates;
    for (const item of bootstrap.templates) {
      const g = item.config?.template?.group || item.group;
      if (g && !state.groups.includes(g)) state.groups.push(g);
    }
    storeGroups();
    state.runs = bootstrap.runs;
    state.historyRuns = bootstrap.history_runs;
    state.roles = bootstrap.roles;
    state.capabilities = bootstrap.capabilities;
    state.models = bootstrap.model_presets;
    if (bootstrap.templates[0]) state.current = normalizeTemplate(bootstrap.templates[0]);
    render();
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.addEventListener('click', () => setView(button.dataset.view as ViewName));
}
byId('refresh-runs').addEventListener('click', () => void refreshRuns());
byId('refresh-history').addEventListener('click', () => void refreshRuns());
render();
void initialize();
