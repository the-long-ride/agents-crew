import { requestJson } from './api.js';
import { mountBuilder } from './builder.js';
import { renderConnectView, type ConnectionAction } from './connect.js';
import { crewActions } from './app/crew-actions.js';
import { promptDialog } from './components/dialog.js';
import { mountInfoPopovers } from './components/info.js';
import { mountSidebarResizers } from './components/sidebar-resizer.js';
import { mountTooltips, rescanTooltips } from './components/tooltip.js';
import { byId } from './dom.js';
import { resetViewport } from './graph/viewport.js';
import { addMember, normalizeCrew, removeMember } from './model.js';
import { renderProcessTable, type ProcessAction } from './processes.js';
import { renderRunView } from './runtime.js';
import { renderAllCrews } from './templates.js';
import { mountThemeToggle } from './theme.js';
import type {
  AppState,
  BootstrapResponse,
  ConnectionStatus,
  MemberConfig,
  CrewRecord,
  ModelCatalogResponse,
  ManagedProcess,
  RunDetail,
  RunSummary,
  ViewName,
} from './types.js';

const state: AppState = {
  crews: [],
  runs: [],
  historyRuns: [],
  connections: [],
  processes: [],
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

const GROUPS_STORAGE_KEY = 'agents-crew-crew-groups';

function readStoredGroups(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(GROUPS_STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  } catch { return []; }
}

function storeGroups(): void {
  try { window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(state.groups)); } catch { /* storage unavailable */ }
  void requestJson('/api/groups', { method: 'PUT', body: JSON.stringify({ groups: state.groups }) }).catch(() => { /* server unavailable */ });
}

state.groups = readStoredGroups();

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

const { saveCrew, deleteCrew, moveCrewGroup, renameCrew, renameGroup } = crewActions(
  state, toast, storeGroups, () => render(), loadModels,
);

let toastTimer: number | undefined;
type ToastType = 'success' | 'error' | 'failed' | 'info';

function toast(message: string, type?: ToastType | boolean): void {
  const node = byId<HTMLDivElement>('toast');
  node.textContent = message;
  const isErr = typeof type === 'boolean' ? type : type === 'error' || type === 'failed' || (!type && /error|fail|cannot|required|invalid|exists|could not/i.test(message));
  const resolved: ToastType = isErr ? 'error' : (type === 'info' ? 'info' : 'success');
  node.classList.remove('success', 'error', 'failed', 'info');
  node.classList.add('show', resolved, isErr ? 'failed' : resolved);
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove('show', 'success', 'error', 'failed', 'info'), 2800);
}

function selectCrew(record: CrewRecord): void {
  state.current = normalizeCrew(record);
  state.selected = null;
  state.viewport = resetViewport();
  render();
}

function setView(view: ViewName): void {
  state.view = view;
  render();
  if (view === 'connect') void refreshConnections();
  if (view === 'runtime') void Promise.all([refreshRuns(), refreshProcesses()]);
}

function newCrew(): void {
  const source = state.crews.find((item) => item.id === 'default') ?? state.crews[0];
  if (!source) { toast('No source crew available'); return; }
  const next = normalizeCrew(source);
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

function newCrewInGroup(groupName: string): void {
  newCrew();
  if (state.current) {
    state.current.group = groupName;
    state.current.config.template.group = groupName;
    if (!state.groups.includes(groupName)) {
      state.groups.push(groupName);
      storeGroups();
    }
    render();
  }
}

async function newGroup(): Promise<void> {
  const groupName = await promptDialog({
    title: 'New Group',
    message: 'Enter group name for organizing crews:',
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

async function newSubGroup(parentName: string): Promise<void> {
  if (parentName === '__ungrouped__') return;
  const child = await promptDialog({
    title: 'New Sub-Group',
    message: `Enter sub-group name under "${parentName}":`,
    placeholder: 'e.g. Promotions, Reviews',
  });
  if (!child) return;
  const fullName = `${parentName}/${child.trim()}`;
  if (!state.groups.includes(fullName)) {
    state.groups.push(fullName);
    storeGroups();
  }
  toast(`Sub-group "${child.trim()}" created under "${parentName}"`);
  render();
}

function deleteGroup(groupName: string): void {
  const isSub = groupName.includes('/');
  const groupsToDelete = isSub
    ? [groupName]
    : [groupName, ...state.groups.filter((g) => g.startsWith(`${groupName}/`))];
  const count = state.crews.filter((t) => {
    const g = t.config.template?.group || t.group;
    return g !== undefined && groupsToDelete.includes(g);
  }).length
    + (state.current && !state.crews.some((t) => t.id === state.current?.id && t.scope === state.current?.scope)
      && groupsToDelete.includes(state.current.config.template?.group || state.current.group || '') ? 1 : 0);
  if (count > 0) {
    toast(`Cannot delete group "${groupName}" because it contains ${count} crew(s)`);
    return;
  }
  state.groups = (state.groups || []).filter((g) => !groupsToDelete.includes(g));
  storeGroups();
  state.collapsedGroups = (state.collapsedGroups || []).filter((g) => !groupsToDelete.includes(g) && !groupsToDelete.some((d) => g.startsWith(`${d}/`)));
  toast(`Group "${groupName}" deleted`);
  render();
}

function addMemberToCurrent(): void {
  if (!state.current) return;
  state.current = addMember(state.current);
  render();
}

function deleteSelected(): void {
  if (!state.current || state.selected?.type !== 'member') return;
  state.current = removeMember(state.current, state.selected.id);
  state.selected = null;
  render();
}


async function refreshConnections(): Promise<void> {
  try {
    state.connections = (await requestJson<{ connections: ConnectionStatus[] }>('/api/connections')).connections;
    renderConnectionView();
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
}

async function controlConnection(host: string, action: ConnectionAction): Promise<void> {
  try {
    await requestJson<ConnectionStatus>(`/api/connections/${encodeURIComponent(host)}/${action}`, { method: 'POST', body: '{}' });
    await refreshConnections();
    toast(`${host}: ${action} complete`);
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
}

async function refreshProcesses(showErrors = true): Promise<void> {
  try {
    state.processes = (await requestJson<{ processes: ManagedProcess[] }>('/api/processes')).processes;
    renderProcessView();
  } catch (error) { if (showErrors) toast(error instanceof Error ? error.message : String(error)); }
}

async function controlProcess(id: string, action: ProcessAction): Promise<void> {
  try {
    await requestJson<unknown>(`/api/processes/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' });
    await Promise.all([refreshProcesses(), refreshRuns()]);
    toast(`Process ${action} requested`);
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
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
  selectCrew,
  newCrew,
  newCrewInGroup,
  newGroup: () => void newGroup(),
  newSubGroup,
  deleteGroup,
  renameGroup,
  addMemberInternal: addMemberToCurrent,
  saveCrew: () => void saveCrew(),
  deleteCrew: (record) => void deleteCrew(record),
  renameCrew,
  moveCrewGroup,
  deleteSelected,
  loadModels,
});
const runtimeActions = { loadRun, controlRun };

function renderConnectionView(): void {
  renderConnectView('connection-list', state.connections, { control: controlConnection });
}

function renderProcessView(): void {
  renderProcessTable('process-list', state.processes, { control: controlProcess });
}

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

const scopeSwitch = byId<HTMLDivElement>('save-scope-control');
const scopeButtons = scopeSwitch.querySelectorAll<HTMLButtonElement>('.scope-switch-option');
function setScope(value: 'global' | 'workspace'): void {
  state.saveScope = value;
  for (const btn of scopeButtons) btn.classList.toggle('active', btn.dataset.scope === value);
  renderBuilderView();
}
for (const btn of scopeButtons) {
  btn.addEventListener('click', () => setScope(btn.dataset.scope === 'workspace' ? 'workspace' : 'global'));
}
mountThemeToggle();
mountTooltips();
mountInfoPopovers();
mountSidebarResizers(byId('builder-view'));

function render(): void {
  for (const view of ['builder', 'crews', 'connect', 'runtime', 'history'] as ViewName[]) {
    byId(`${view}-view`).hidden = state.view !== view;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.classList.toggle('active', button.dataset.view === state.view);
  }
  setScope(state.saveScope);
  renderBuilderView();
  renderAllCrews(state, {
    open(record) { selectCrew(record); setView('builder'); },
    delete(record) { void deleteCrew(record); },
  });
  renderConnectionView();
  renderProcessView();
  renderRunViews();
  rescanTooltips();
}

async function initialize(): Promise<void> {
  try {
    const bootstrap = await requestJson<BootstrapResponse>('/api/bootstrap');
    state.crews = bootstrap.crews;
    const seen = new Set<string>();
    for (const g of bootstrap.groups ?? []) {
      if (g && !seen.has(g)) { seen.add(g); state.groups.push(g); }
    }
    for (const item of bootstrap.crews) {
      const g = item.config?.template?.group;
      if (g && !seen.has(g)) { seen.add(g); state.groups.push(g); }
    }
    storeGroups();
    state.runs = bootstrap.runs;
    state.historyRuns = bootstrap.history_runs;
    state.roles = bootstrap.roles;
    state.capabilities = bootstrap.capabilities;
    state.models = bootstrap.model_presets;
    if (bootstrap.crews[0]) state.current = normalizeCrew(bootstrap.crews[0]);
    render();
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.addEventListener('click', () => setView(button.dataset.view as ViewName));
}
byId('refresh-runs').addEventListener('click', () => void Promise.all([refreshRuns(), refreshProcesses()]));
byId('refresh-connections').addEventListener('click', () => void refreshConnections());
byId('refresh-history').addEventListener('click', () => void refreshRuns());
byId('shutdown-button').addEventListener('click', () => { void requestJson<unknown>('/api/shutdown', { method: 'POST' }); window.close(); });
window.setInterval(() => { if (state.view === 'runtime') void refreshProcesses(false); }, 1500);
render();
void initialize();