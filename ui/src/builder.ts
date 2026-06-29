import { mountCombobox, type ComboboxController, type ComboboxOption } from './components/combobox.js';
import { byId, checked, escapeHtml } from './dom.js';
import { fitViewport, panViewport, resetViewport, resizeViewport, zoomViewportAt } from './graph/viewport.js';
import { edgeLayout, nodeLayout } from './model.js';
import type {
  AppState,
  CanvasNode,
  ManagerConfig,
  ModelCatalogResponse,
  ModelSuggestion,
  TemplateRecord,
  WorkerConfig,
} from './types.js';

export interface BuilderActions {
  selectTemplate(record: TemplateRecord): void;
  newTemplate(): void;
  addWorker(): void;
  deleteSelected(): void;
  loadModels(host: string, refresh?: boolean): Promise<ModelCatalogResponse>;
}

function selectedData(state: AppState): ManagerConfig | WorkerConfig | null {
  if (!state.current || !state.selected) return null;
  if (state.selected.type === 'manager') return state.current.config.manager;
  return state.current.config.workers.find((worker) => worker.id === state.selected?.id) ?? null;
}

function adapterValue(state: AppState, data: ManagerConfig | WorkerConfig): string {
  if (state.selected?.type === 'manager') return (data as ManagerConfig).host;
  const worker = data as WorkerConfig;
  return worker.adapter ?? worker.provider ?? worker.host ?? worker.kind;
}

function updateAdapter(state: AppState, data: ManagerConfig | WorkerConfig, value: string): void {
  if (state.selected?.type === 'manager') { (data as ManagerConfig).host = value; return; }
  const worker = data as WorkerConfig;
  if (worker.kind === 'api') worker.provider = value;
  else if (worker.kind === 'native') worker.host = value;
  else worker.adapter = value;
}

function toggle(values: string[], value: string, enabled: boolean): void {
  const index = values.indexOf(value);
  if (enabled && index < 0) values.push(value);
  if (!enabled && index >= 0) values.splice(index, 1);
}

function adapterOptions(state: AppState, data: ManagerConfig | WorkerConfig): ComboboxOption[] {
  if (state.selected?.type === 'manager') {
    return ['claude-code', 'codex', 'antigravity', 'opencode'].map((value) => ({ value, label: value }));
  }
  const worker = data as WorkerConfig;
  const values = worker.kind === 'api'
    ? ['openai', 'anthropic', 'google']
    : worker.kind === 'native'
      ? ['manager', 'claude-code', 'codex', 'antigravity']
      : ['opencode', 'codex', 'claude-code', 'antigravity'];
  return values.map((value) => ({ value, label: value }));
}

function contextLabel(context: number | undefined): string {
  if (!context) return '';
  if (context >= 1_000_000) return `${Math.round(context / 1_000_000)}M context`;
  if (context >= 1_000) return `${Math.round(context / 1_000)}K context`;
  return `${context} context`;
}

function modelDescription(model: ModelSuggestion): string {
  return [model.provider, contextLabel(model.context), model.reasoning ? 'reasoning' : '', model.tool_call ? 'tools' : '', model.attachment ? 'files' : '']
    .filter(Boolean).join(' · ');
}

function modelOptions(state: AppState, catalog?: ModelCatalogResponse): ComboboxOption[] {
  const options: ComboboxOption[] = state.models.map((value) => ({ value, label: value, description: 'Manual/default model setting' }));
  for (const model of catalog?.models ?? []) {
    if (options.some((option) => option.value === model.id)) continue;
    options.push({ value: model.id, label: model.name, description: modelDescription(model), keywords: [model.provider] });
  }
  return options;
}

function catalogStatus(catalog: ModelCatalogResponse): string {
  if (catalog.source === 'live') return `Models.dev live catalog · ${catalog.models.length} models`;
  if (catalog.source === 'cache') return `Models.dev cache · ${catalog.models.length} models`;
  if (catalog.source === 'stale') return `Stale catalog · ${catalog.error ?? 'refresh failed'} · manual IDs still work`;
  if (catalog.source === 'none') return 'No public catalog mapping for this host · enter a model ID manually';
  return `Catalog unavailable · ${catalog.error ?? 'unknown error'} · enter a model ID manually`;
}

export function mountBuilder(state: AppState, actions: BuilderActions): () => void {
  const search = byId<HTMLInputElement>('template-search');
  const list = byId<HTMLDivElement>('template-list');
  const canvas = byId<HTMLDivElement>('crew-canvas');
  const world = byId<HTMLDivElement>('crew-world');
  const title = byId<HTMLElement>('canvas-title');
  const inspector = byId<HTMLDivElement>('inspector');
  const zoomLevel = byId<HTMLElement>('zoom-level');
  let canvasSize = { width: canvas.clientWidth, height: canvas.clientHeight };
  let inspectorControls: ComboboxController[] = [];
  let panStart: { pointerId: number; x: number; y: number; clientX: number; clientY: number } | null = null;

  function clearInspectorControls(): void {
    for (const control of inspectorControls) control.destroy();
    inspectorControls = [];
  }

  function applyViewport(): void {
    const { x, y, scale } = state.viewport;
    world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    canvas.style.setProperty('--grid-size', `${24 * scale}px`);
    canvas.style.setProperty('--grid-x', `${x}px`);
    canvas.style.setProperty('--grid-y', `${y}px`);
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;
  }

  function renderTemplateList(): void {
    const query = state.search.trim().toLowerCase();
    const filtered = query
      ? state.templates.filter((item) => `${item.id} ${item.name}`.toLowerCase().includes(query))
      : state.templates;
    list.innerHTML = filtered.length ? filtered.map((item) => `<button type="button" class="list-row${state.current?.id === item.id && state.current.scope === item.scope ? ' selected' : ''}" data-template="${escapeHtml(item.scope)}:${escapeHtml(item.id)}"><span>${escapeHtml(item.name)}</span><small>${escapeHtml(item.scope)}</small></button>`).join('') : '<div class="empty">No matching templates.</div>';
    for (const button of list.querySelectorAll<HTMLButtonElement>('[data-template]')) {
      button.addEventListener('click', () => {
        const record = state.templates.find((item) => `${item.scope}:${item.id}` === button.dataset.template);
        if (record) actions.selectTemplate(record);
      });
    }
  }

  function renderEdges(nodes = state.current ? nodeLayout(state.current) : []): void {
    const svg = world.querySelector<SVGElement>('.edges');
    if (!svg) return;
    svg.innerHTML = edgeLayout(nodes).map((edge) => `<line x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}"></line>`).join('');
  }

  function selectNode(node: CanvasNode, button: HTMLButtonElement): void {
    state.selected = { id: node.id, type: node.type };
    for (const item of world.querySelectorAll('.crew-node')) item.classList.toggle('selected', item === button);
    renderInspector();
  }

  function bindNode(button: HTMLButtonElement, node: CanvasNode, nodes: CanvasNode[]): void {
    button.addEventListener('click', () => selectNode(node, button));
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      selectNode(node, button);
      button.setPointerCapture(event.pointerId);
      const origin = { x: node.x, y: node.y, clientX: event.clientX, clientY: event.clientY };
      const move = (next: PointerEvent): void => {
        if (!state.current) return;
        node.x = Math.round(origin.x + (next.clientX - origin.clientX) / state.viewport.scale);
        node.y = Math.round(origin.y + (next.clientY - origin.clientY) / state.viewport.scale);
        state.current.config.template.layout[node.id] = { x: node.x, y: node.y };
        button.style.transform = `translate(${node.x}px, ${node.y}px)`;
        renderEdges(nodes);
      };
      const end = (): void => {
        button.removeEventListener('pointermove', move);
        button.removeEventListener('pointerup', end);
        button.removeEventListener('pointercancel', end);
      };
      button.addEventListener('pointermove', move);
      button.addEventListener('pointerup', end);
      button.addEventListener('pointercancel', end);
    });
  }

  function renderCanvas(): void {
    title.textContent = state.current?.config.template.name ?? 'No template';
    if (!state.current) {
      world.innerHTML = '<div class="canvas-empty">No template selected.</div>';
      applyViewport();
      return;
    }
    const nodes = nodeLayout(state.current);
    world.innerHTML = `<svg class="edges" aria-hidden="true"></svg>${nodes.map((node) => `<button type="button" class="crew-node ${node.type}${state.selected?.id === node.id ? ' selected' : ''}" data-node="${escapeHtml(node.id)}" style="transform: translate(${node.x}px, ${node.y}px)"><span class="node-kind">${escapeHtml(node.type)}</span><strong>${escapeHtml(node.data.alias || node.id)}</strong><small>${escapeHtml(node.type === 'manager' ? (node.data as ManagerConfig).host : adapterValue(state, node.data))}</small><code>${escapeHtml(node.data.model || 'host default')}</code></button>`).join('')}`;
    renderEdges(nodes);
    for (const button of world.querySelectorAll<HTMLButtonElement>('[data-node]')) {
      const node = nodes.find((item) => item.id === button.dataset.node);
      if (node) bindNode(button, node, nodes);
    }
    applyViewport();
  }

  async function loadCatalog(host: string, controller: ComboboxController, status: HTMLElement, refresh = false): Promise<void> {
    status.textContent = 'Loading public model catalog…';
    try {
      const catalog = await actions.loadModels(host, refresh);
      if (!status.isConnected) return;
      controller.setOptions(modelOptions(state, catalog), catalog.models.length ? 'No matching models' : 'Enter a model ID manually');
      status.textContent = catalogStatus(catalog);
    } catch (error) {
      if (!status.isConnected) return;
      controller.setOptions(modelOptions(state), 'Enter a model ID manually');
      status.textContent = `Catalog unavailable · ${error instanceof Error ? error.message : String(error)} · manual IDs still work`;
    }
  }

  function renderInspector(): void {
    clearInspectorControls();
    const data = selectedData(state);
    if (!data) { inspector.innerHTML = '<div class="empty">Select a host or worker node.</div>'; return; }
    const worker = state.selected?.type === 'worker' ? data as WorkerConfig : null;
    inspector.innerHTML = `<form class="inspector-form" onsubmit="return false">
      <label>Alias<input class="input" data-field="alias" value="${escapeHtml(data.alias ?? '')}"></label>
      <div class="field-label"><span>Adapter / host</span><div id="adapter-combobox"></div></div>
      <div class="field-label"><span>Model ID</span><div class="field-row"><div id="model-combobox"></div><button id="refresh-models" type="button" class="secondary-button">Refresh</button></div><p id="model-status" class="field-note">Public catalog suggestions; manual IDs are accepted.</p></div>
      ${worker ? `<fieldset><legend>Roles</legend><div class="check-grid">${state.roles.map((role) => `<label><input data-role="${escapeHtml(role)}" type="checkbox"${checked(worker.roles.includes(role))}> ${escapeHtml(role)}</label>`).join('')}</div></fieldset><fieldset><legend>Capabilities</legend><div class="check-grid">${state.capabilities.map((capability) => `<label><input data-capability="${escapeHtml(capability)}" type="checkbox"${checked(worker.capabilities.includes(capability))}> ${escapeHtml(capability)}</label>`).join('')}</div></fieldset><label class="toggle"><input data-field="network" type="checkbox"${checked(worker.requires_network ?? false)}> Requires network</label><label class="toggle"><input data-field="credentials" type="checkbox"${checked(worker.requires_credentials ?? false)}> Requires credentials</label><button id="delete-worker" type="button" class="danger-button">Delete worker</button>` : ''}
    </form>`;

    const currentAdapter = adapterValue(state, data);
    const adapter = mountCombobox(byId('adapter-combobox'), {
      id: 'adapter-host', value: currentAdapter, options: adapterOptions(state, data), allowCustom: true,
      placeholder: 'Choose or enter host',
      onChange(value) { updateAdapter(state, data, value); renderCanvas(); renderInspector(); },
    });
    const model = mountCombobox(byId('model-combobox'), {
      id: 'model-id', value: data.model ?? '', options: modelOptions(state, state.modelCatalogs[currentAdapter]),
      allowCustom: true, placeholder: 'Choose or enter model ID',
      onChange(value) { data.model = value; renderCanvas(); },
    });
    inspectorControls.push(adapter, model);
    const status = byId<HTMLElement>('model-status');
    void loadCatalog(currentAdapter, model, status);
    byId('refresh-models').addEventListener('click', () => void loadCatalog(adapterValue(state, data), model, status, true));
    inspector.querySelector<HTMLInputElement>('[data-field="alias"]')?.addEventListener('input', (event) => { data.alias = (event.target as HTMLInputElement).value; renderCanvas(); });
    if (!worker) return;
    for (const input of inspector.querySelectorAll<HTMLInputElement>('[data-role]')) input.addEventListener('change', () => toggle(worker.roles, input.dataset.role as string, input.checked));
    for (const input of inspector.querySelectorAll<HTMLInputElement>('[data-capability]')) input.addEventListener('change', () => toggle(worker.capabilities, input.dataset.capability as string, input.checked));
    inspector.querySelector<HTMLInputElement>('[data-field="network"]')?.addEventListener('change', (event) => { worker.requires_network = (event.target as HTMLInputElement).checked; });
    inspector.querySelector<HTMLInputElement>('[data-field="credentials"]')?.addEventListener('change', (event) => { worker.requires_credentials = (event.target as HTMLInputElement).checked; });
    inspector.querySelector('#delete-worker')?.addEventListener('click', actions.deleteSelected);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('.crew-node')) return;
    canvas.setPointerCapture(event.pointerId);
    panStart = { pointerId: event.pointerId, x: state.viewport.x, y: state.viewport.y, clientX: event.clientX, clientY: event.clientY };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!panStart || event.pointerId !== panStart.pointerId) return;
    state.viewport = { ...state.viewport, x: panStart.x + event.clientX - panStart.clientX, y: panStart.y + event.clientY - panStart.clientY };
    applyViewport();
  });
  const endPan = (event: PointerEvent): void => { if (panStart?.pointerId === event.pointerId) panStart = null; };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * .0015);
    state.viewport = zoomViewportAt(state.viewport, state.viewport.scale * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    applyViewport();
  }, { passive: false });

  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => {
      const next = { width: canvas.clientWidth, height: canvas.clientHeight };
      state.viewport = resizeViewport(state.viewport, canvasSize, next);
      canvasSize = next;
      applyViewport();
    });
    resizeObserver.observe(canvas);
  }

  search.addEventListener('input', () => { state.search = search.value; renderTemplateList(); });
  byId('new-template').addEventListener('click', actions.newTemplate);
  byId('add-worker').addEventListener('click', actions.addWorker);
  byId('fit-graph').addEventListener('click', () => {
    if (!state.current) return;
    state.viewport = fitViewport(nodeLayout(state.current), { width: canvas.clientWidth, height: canvas.clientHeight });
    applyViewport();
  });
  byId('reset-zoom').addEventListener('click', () => { state.viewport = resetViewport(); applyViewport(); });

  return (): void => {
    search.value = state.search;
    renderTemplateList();
    renderCanvas();
    renderInspector();
  };
}
