import { requestJson } from './api.js';
import { mountBuilder } from './builder.js';
import { mountCombobox } from './components/combobox.js';
import { mountInfoPopovers } from './components/info.js';
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
};

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

async function saveCurrent(): Promise<void> {
  if (!state.current) return;
  const metadata = state.current.config.template;
  const name = window.prompt('Template name', metadata.name)?.trim();
  if (!name) return;
  const id = window.prompt('Template ID (lowercase slug)', metadata.id)?.trim();
  if (!id) return;
  metadata.id = id;
  metadata.name = name;
  state.current.id = id;
  state.current.name = name;
  try {
    const saved = await requestJson<TemplateRecord>(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(savePayload(state.current, state.saveScope)),
    });
    const index = state.templates.findIndex((item) => item.id === saved.id && item.scope === saved.scope);
    if (index >= 0) state.templates[index] = saved;
    else state.templates.push(saved);
    state.templates.sort((left, right) => left.id.localeCompare(right.id));
    state.current = normalizeTemplate(saved);
    state.selected = null;
    toast('Template saved');
    render();
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
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
  addWorker: addWorkerToCurrent,
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

function render(): void {
  for (const view of ['builder', 'templates', 'runtime', 'history'] as ViewName[]) {
    byId(`${view}-view`).hidden = state.view !== view;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.classList.toggle('active', button.dataset.view === state.view);
  }
  scopeControl.setValue(state.saveScope);
  byId<HTMLButtonElement>('save-template').disabled = !state.current;
  renderBuilderView();
  renderTemplates(state, (record) => { selectTemplate(record); setView('builder'); });
  renderRunViews();
}

async function initialize(): Promise<void> {
  try {
    const bootstrap = await requestJson<BootstrapResponse>('/api/bootstrap');
    state.templates = bootstrap.templates;
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
byId('save-template').addEventListener('click', () => void saveCurrent());
byId('refresh-runs').addEventListener('click', () => void refreshRuns());
byId('refresh-history').addEventListener('click', () => void refreshRuns());
render();
void initialize();
