import { mountCombobox, type ComboboxController, type ComboboxOption } from './components/combobox.js';
import { byId, checked, escapeHtml } from './dom.js';
import { fitViewport, panViewport, resetViewport, resizeViewport, zoomViewportAt } from './graph/viewport.js';
import { edgeLayout, nodeLayout } from './model.js';
import type {
  AppState,
  CanvasNode,
  BossInformation,
  ModelCatalogResponse,
  ModelSuggestion,
  CrewRecord,
  MemberConfig,
} from './types.js';

export interface BuilderActions {
  selectCrew(record: CrewRecord): void;
  newCrew(): void;
  newGroup?: () => void;
  deleteGroup?: (groupName: string) => void;
  renameGroup?(oldName: string, newName: string): Promise<boolean>;
  addMemberInternal(): void;
  saveCrew(): void;
  deleteCrew(record?: CrewRecord): void;
  renameCrew?(record: CrewRecord, newName: string): Promise<boolean>;
  moveCrewGroup?(record: CrewRecord, group: string | undefined): Promise<boolean>;
  deleteSelected(): void;
  loadModels(host: string, refresh?: boolean): Promise<ModelCatalogResponse>;
}

function selectedData(state: AppState): BossInformation | MemberConfig | null {
  if (!state.current || !state.selected) return null;
  if (state.selected.type === 'boss') return state.current.config.manager;
  return state.current.config.workers.find((member) => member.id === state.selected?.id) ?? null;
}

function adapterValue(state: AppState, data: BossInformation | MemberConfig): string {
  if (state.selected?.type === 'boss') return (data as BossInformation).host;
  const member = data as MemberConfig;
  return member.adapter ?? member.provider ?? member.host ?? member.kind;
}

function updateAdapter(state: AppState, data: BossInformation | MemberConfig, value: string): void {
  if (state.selected?.type === 'boss') { (data as BossInformation).host = value; return; }
  const member = data as MemberConfig;
  if (member.kind === 'api') member.provider = value;
  else if (member.kind === 'native') member.host = value;
  else member.adapter = value;
}

function toggle(values: string[], value: string, enabled: boolean): void {
  const index = values.indexOf(value);
  if (enabled && index < 0) values.push(value);
  if (!enabled && index >= 0) values.splice(index, 1);
}

function adapterOptions(state: AppState, data: BossInformation | MemberConfig): ComboboxOption[] {
  if (state.selected?.type === 'boss') {
    return ['claude-code', 'codex', 'antigravity', 'opencode'].map((value) => ({ value, label: value }));
  }
  const member = data as MemberConfig;
  const values = member.kind === 'api'
    ? ['openai', 'anthropic', 'google']
    : member.kind === 'native'
      ? ['boss', 'claude-code', 'codex', 'antigravity']
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

export function modelValueForAdapter(adapter: string, model: ModelSuggestion): string {
  const normalized = adapter.trim().toLowerCase();
  if (normalized !== 'opencode') return model.id;
  return model.id.startsWith(`${model.provider}/`) ? model.id : `${model.provider}/${model.id}`;
}

export function modelOptionsForCatalog(catalog?: ModelCatalogResponse): ComboboxOption[] {
  if (!catalog || !['live', 'cache'].includes(catalog.source)) return [];
  return catalog.models.map((model) => ({
    value: modelValueForAdapter(catalog.host, model),
    label: model.name,
    description: modelDescription(model),
    keywords: [model.provider, model.id],
  }));
}

export function modelIsAvailable(adapter: string, model: string | undefined, catalog?: ModelCatalogResponse): boolean {
  const value = model?.trim() ?? '';
  if (!value) return true;
  if (!catalog || !['live', 'cache'].includes(catalog.source)) return false;
  return modelOptionsForCatalog(catalog).some((option) => option.value === value)
    && catalog.host.trim().toLowerCase() === adapter.trim().toLowerCase();
}

function catalogStatus(catalog: ModelCatalogResponse): string {
  if (catalog.source === 'live') return `Models.dev live catalog · ${catalog.models.length} models`;
  if (catalog.source === 'cache') return `Models.dev cache · ${catalog.models.length} models`;
  if (catalog.source === 'stale') return `Catalog is stale · ${catalog.error ?? 'refresh failed'} · no models selectable`;
  if (catalog.source === 'none') return 'No catalog mapping for this adapter';
  return `Catalog unavailable · ${catalog.error ?? 'unknown error'} · no models selectable`;
}

export function mountBuilder(state: AppState, actions: BuilderActions): () => void {
  const search = byId<HTMLInputElement>('crew-search');
  const list = byId<HTMLDivElement>('crew-list');
  const canvas = byId<HTMLDivElement>('crew-canvas');
  const world = byId<HTMLDivElement>('crew-world');
  const title = byId<HTMLElement>('canvas-title');
  const crewName = byId<HTMLInputElement>('crew-name');
  const crewId = byId<HTMLInputElement>('crew-id');
  const crewGroup = byId<HTMLSelectElement>('crew-group');
  const saveCrew = byId<HTMLButtonElement>('save-crew');
  const deleteCrew = byId<HTMLButtonElement>('delete-crew');
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

  function renderMetadata(): void {
    const metadata = state.current?.config.template;
    title.textContent = metadata?.name ?? 'No crew';
    crewName.value = metadata?.name ?? '';
    crewId.value = metadata?.id ?? '';

    const currentGroup = metadata?.group ?? state.current?.group ?? '';
    const definedGroups = new Set<string>(state.groups || []);
    for (const item of state.crews) {
      const g = item.config?.template?.group || item.group;
      if (g) definedGroups.add(g);
    }
    if (currentGroup) definedGroups.add(currentGroup);

    let groupOptions = '<option value="">None (Ungrouped)</option>';
    for (const g of Array.from(definedGroups).sort()) {
      groupOptions += `<option value="${escapeHtml(g)}"${g === currentGroup ? ' selected' : ''}>${escapeHtml(g)}</option>`;
    }
    crewGroup.innerHTML = groupOptions;
    crewGroup.value = currentGroup;

    crewName.disabled = !metadata;
    crewId.disabled = !metadata;
    crewGroup.disabled = !metadata;
    saveCrew.disabled = !metadata;
    deleteCrew.disabled = !state.current?.path || state.current.scope === 'builtin';
  }

  function renderCrewList(): void {
    const query = state.search.trim().toLowerCase();
    const filtered = query
      ? state.crews.filter((item) => `${item.id} ${item.name} ${item.config.template?.group || item.group || ''}`.toLowerCase().includes(query))
      : state.crews;

    if (!filtered.length) {
      list.innerHTML = '<div class="empty">No matching crews.</div>';
      return;
    }

    const definedGroups = new Set<string>(state.groups || []);
    for (const item of state.crews) {
      const g = item.config.template?.group || item.group;
      if (g) definedGroups.add(g);
    }

    if (state.current) {
      const activeGroup = state.current.config.template?.group || state.current.group;
      const targetGroup = activeGroup || '__ungrouped__';
      if (state.collapsedGroups?.includes(targetGroup)) {
        state.collapsedGroups = state.collapsedGroups.filter((g) => g !== targetGroup);
      }
    }

    const groupMap = new Map<string, CrewRecord[]>();
    for (const g of definedGroups) {
      groupMap.set(g, []);
    }

    const ungrouped: CrewRecord[] = [];
    for (const item of filtered) {
      const g = item.config.template?.group || item.group;
      if (g && groupMap.has(g)) {
        groupMap.get(g)!.push(item);
      } else if (g) {
        groupMap.set(g, [item]);
      } else {
        ungrouped.push(item);
      }
    }

    let html = '';
    for (const [groupName, items] of groupMap.entries()) {
      const isCollapsed = (state.collapsedGroups || []).includes(groupName);
      const isGroupEmpty = items.length === 0;
      html += `<div class="group-section" data-drop-group="${escapeHtml(groupName)}">` +
        `<div class="group-header">` +
        `<button type="button" class="group-header-toggle${isCollapsed ? ' collapsed' : ''}" data-group-toggle="${escapeHtml(groupName)}" aria-expanded="${!isCollapsed}">` +
          `<span class="group-header-title">` +
            `<svg class="group-chevron" viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5"></path></svg>` +
            `<span>${escapeHtml(groupName)}</span>` +
          `</span>` +
        `</button>` +
          `<div class="group-header-right">` +
            `<small>(${items.length})</small>` +
            (isGroupEmpty ? `<button type="button" class="group-delete-button" data-delete-group="${escapeHtml(groupName)}" aria-label="Delete empty group ${escapeHtml(groupName)}" title="Delete group">` +
              `<svg class="button-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M4 4.5l.7 8.4a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>` +
            `</button>` : '') +
          `</div>` +
        `</div>` +
        `<div class="group-items${isCollapsed ? ' collapsed' : ''}">` +
          (items.length
            ? items.map(renderRow).join('')
            : '<div class="group-empty">No crews in this group.</div>') +
        `</div>` +
      `</div>`;
    }

    if (ungrouped.length || definedGroups.size > 0) {
      if (definedGroups.size > 0) {
        const isCollapsed = (state.collapsedGroups || []).includes('__ungrouped__');
        html += `<div class="group-section" data-drop-group="__ungrouped__">` +
          `<div class="group-header">` +
          `<button type="button" class="group-header-toggle${isCollapsed ? ' collapsed' : ''}" data-group-toggle="__ungrouped__" aria-expanded="${!isCollapsed}">` +
            `<span class="group-header-title">` +
              `<svg class="group-chevron" viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5"></path></svg>` +
              `<span>Ungrouped</span>` +
            `</span>` +
            `<small>(${ungrouped.length})</small>` +
          `</button>` +
          `</div>` +
          `<div class="group-items${isCollapsed ? ' collapsed' : ''}">` +
            ungrouped.map(renderRow).join('') +
          `</div>` +
        `</div>`;
      } else {
        html += `<div class="group-items">${ungrouped.map(renderRow).join('')}</div>`;
      }
    }

    list.innerHTML = html;

    for (const toggleBtn of list.querySelectorAll<HTMLButtonElement>('[data-group-toggle]')) {
      toggleBtn.addEventListener('click', () => {
        const gName = toggleBtn.dataset.groupToggle!;
        state.collapsedGroups = state.collapsedGroups || [];
        if (state.collapsedGroups.includes(gName)) {
          state.collapsedGroups = state.collapsedGroups.filter((g) => g !== gName);
        } else {
          state.collapsedGroups.push(gName);
        }
        renderCrewList();
      });
    }

    for (const deleteGroupBtn of list.querySelectorAll<HTMLButtonElement>('[data-delete-group]')) {
      deleteGroupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const gName = deleteGroupBtn.dataset.deleteGroup!;
        actions.deleteGroup?.(gName);
      });
    }

    for (const titleEl of list.querySelectorAll<HTMLElement>('.group-header-title span:last-child')) {
      titleEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const header = titleEl.closest('.group-header') as HTMLElement;
        const toggleBtn = header?.querySelector<HTMLButtonElement>('[data-group-toggle]');
        const groupName = toggleBtn?.dataset.groupToggle;
        if (!groupName || groupName === '__ungrouped__') return;
        const oldName = groupName;
        const currentText = titleEl.textContent ?? '';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentText;
        input.className = 'input group-rename-input';
        input.style.cssText = 'font: 600 11px/1.2 var(--mono); padding: 2px 4px; width: 120px;';
        titleEl.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          const val = input.value.trim();
          input.replaceWith(titleEl);
          if (val && val !== oldName) {
            void actions.renameGroup?.(oldName, val);
          }
        };
        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') { ke.preventDefault(); finish(); }
          else if (ke.key === 'Escape') { ke.preventDefault(); done = true; input.replaceWith(titleEl); }
        });
      });
    }

    for (const selectBtn of list.querySelectorAll<HTMLButtonElement>('[data-select-crew]')) {
      selectBtn.addEventListener('click', () => {
        const record = state.crews.find((item) => `${item.scope}:${item.id}` === selectBtn.dataset.selectCrew);
        if (record) actions.selectCrew(record);
      });
    }

    for (const deleteBtn of list.querySelectorAll<HTMLButtonElement>('[data-delete-crew]')) {
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const record = state.crews.find((item) => `${item.scope}:${item.id}` === deleteBtn.dataset.deleteCrew);
        if (record) actions.deleteCrew(record);
      });
    }

    for (const nameEl of list.querySelectorAll<HTMLElement>('.list-row-name')) {
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const row = nameEl.closest('.list-row') as HTMLElement;
        if (!row) return;
        const key = row.dataset.crew;
        const record = state.crews.find((item) => `${item.scope}:${item.id}` === key);
        if (!record || record.scope === 'builtin' || !record.path) return;
        const currentText = nameEl.textContent ?? '';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentText;
        input.className = 'input list-row-rename-input';
        input.style.cssText = 'width: 100%; padding: 2px 4px; font-weight: 500;';
        nameEl.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          const val = input.value.trim();
          input.replaceWith(nameEl);
          if (val && val !== currentText) {
            void actions.renameCrew?.(record, val);
          }
        };
        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') { ke.preventDefault(); finish(); }
          else if (ke.key === 'Escape') { ke.preventDefault(); done = true; input.replaceWith(nameEl); }
        });
      });
    }

    let draggedCrewKey: string | null = null;

    for (const row of list.querySelectorAll<HTMLElement>('.list-row[draggable="true"]')) {
      row.addEventListener('dragstart', (e) => {
        const key = row.dataset.crew!;
        draggedCrewKey = key;
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', key);
          e.dataTransfer.effectAllowed = 'move';
        }
        row.classList.add('dragging');
      });

      row.addEventListener('dragend', () => {
        draggedCrewKey = null;
        row.classList.remove('dragging');
        for (const section of list.querySelectorAll<HTMLElement>('[data-drop-group]')) {
          section.classList.remove('drag-over');
        }
      });
    }

    for (const section of list.querySelectorAll<HTMLElement>('[data-drop-group]')) {
      section.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        section.classList.add('drag-over');
      });

      section.addEventListener('dragleave', (e) => {
        if (!section.contains(e.relatedTarget as Node)) {
          section.classList.remove('drag-over');
        }
      });

      section.addEventListener('drop', (e) => {
        e.preventDefault();
        section.classList.remove('drag-over');
        const key = e.dataTransfer?.getData('text/plain') || draggedCrewKey;
        if (!key) return;

        const record = state.crews.find((item) => `${item.scope}:${item.id}` === key);
        if (!record) return;

        const rawGroup = section.dataset.dropGroup!;
        const targetGroup = rawGroup === '__ungrouped__' ? undefined : rawGroup;

        const currentGroup = record.config.template?.group || record.group;
        if (currentGroup === targetGroup) return;

        void (async () => {
          if (actions.moveCrewGroup && !(await actions.moveCrewGroup(record, targetGroup))) return;
          record.group = targetGroup;
          record.config.template.group = targetGroup;
          if (state.current && `${state.current.scope}:${state.current.id}` === key) {
            state.current.group = targetGroup;
            state.current.config.template.group = targetGroup;
            renderMetadata();
          }
          const collapseKey = targetGroup || '__ungrouped__';
          if (state.collapsedGroups?.includes(collapseKey)) {
            state.collapsedGroups = state.collapsedGroups.filter((g) => g !== collapseKey);
          }
          renderCrewList();
        })();
      });
    }
  }

  function renderRow(item: CrewRecord): string {
    const isSelected = state.current?.id === item.id && state.current.scope === item.scope;
    const canDelete = Boolean(item.path && item.scope !== 'builtin');
    const key = `${escapeHtml(item.scope)}:${escapeHtml(item.id)}`;
    return `<div class="list-row${isSelected ? ' selected' : ''}" data-crew="${key}" draggable="true">` +
      `<button type="button" class="list-row-select" data-select-crew="${key}">` +
        `<span class="list-row-name">${escapeHtml(item.name)}</span>` +
        `<small>${escapeHtml(item.scope)}</small>` +
      `</button>` +
      (canDelete
        ? `<button type="button" class="list-row-delete" data-delete-crew="${key}" aria-label="Delete crew ${escapeHtml(item.name)}" title="Delete crew">` +
            `<svg class="button-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M4 4.5l.7 8.4a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>` +
          `</button>`
        : '') +
    `</div>`;
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
    if (!state.current) {
      world.innerHTML = '<div class="canvas-empty">No crew selected.</div>';
      applyViewport();
      return;
    }
    const nodes = nodeLayout(state.current);
    world.innerHTML = `<svg class="edges" aria-hidden="true"></svg>${nodes.map((node) => `<button type="button" class="crew-node ${node.type}${state.selected?.id === node.id ? ' selected' : ''}" data-node="${escapeHtml(node.id)}" style="transform: translate(${node.x}px, ${node.y}px)"><span class="node-kind">${escapeHtml(node.type)}</span><strong>${escapeHtml(node.data.alias || node.id)}</strong><small>${escapeHtml(node.type === 'boss' ? (node.data as BossInformation).host : adapterValue(state, node.data))}</small><code>${escapeHtml(node.data.model || 'host default')}</code></button>`).join('')}`;
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
      const options = modelOptionsForCatalog(catalog);
      controller.setOptions(options, catalog.models.length ? 'No matching text LLMs' : 'No models available');
      const data = selectedData(state);
      if (data?.model && !options.some((option) => option.value === data.model)) {
        data.model = '';
        controller.setValue('');
        renderCanvas();
      }
      status.textContent = catalogStatus(catalog);
    } catch (error) {
      if (!status.isConnected) return;
      controller.setOptions([], 'No models available');
      const data = selectedData(state);
      if (data) data.model = '';
      controller.setValue('');
      renderCanvas();
      status.textContent = `Catalog unavailable · ${error instanceof Error ? error.message : String(error)} · no models selectable`;
    }
  }

  function renderInspector(): void {
    clearInspectorControls();
    const data = selectedData(state);
    if (!data) { inspector.innerHTML = '<div class="empty">Select a boss or member node.</div>'; return; }
    const member = state.selected?.type === 'member' ? data as MemberConfig : null;
    inspector.innerHTML = `<form class="inspector-form" onsubmit="return false">
      <label>Alias<input class="input" data-field="alias" value="${escapeHtml(data.alias ?? '')}"></label>
      <div class="field-label"><span>Adapter / host</span><div id="adapter-combobox"></div></div>
      <div class="field-label"><span>Model</span><div class="field-row"><div id="model-combobox"></div><button id="refresh-models" type="button" class="secondary-button">Refresh</button></div><p id="model-status" class="field-note">Current text LLMs for the selected adapter.</p></div>
      ${member ? `<fieldset><legend>Roles</legend><div class="check-grid">${state.roles.map((role) => `<label><input data-role="${escapeHtml(role)}" type="checkbox"${checked(member.roles.includes(role))}> ${escapeHtml(role)}</label>`).join('')}</div></fieldset><fieldset><legend>Capabilities</legend><div class="check-grid">${state.capabilities.map((capability) => `<label><input data-capability="${escapeHtml(capability)}" type="checkbox"${checked(member.capabilities.includes(capability))}> ${escapeHtml(capability)}</label>`).join('')}</div></fieldset><label class="toggle"><input data-field="network" type="checkbox"${checked(member.requires_network ?? false)}> Requires network</label><label class="toggle"><input data-field="credentials" type="checkbox"${checked(member.requires_credentials ?? false)}> Requires credentials</label><button id="delete-member" type="button" class="danger-button">Delete member</button>` : ''}
    </form>`;

    const currentAdapter = adapterValue(state, data);
    const adapter = mountCombobox(byId('adapter-combobox'), {
      id: 'adapter-host', value: currentAdapter, options: adapterOptions(state, data), allowCustom: false,
      placeholder: 'Choose adapter',
      onChange(value) { updateAdapter(state, data, value); data.model = ''; renderCanvas(); renderInspector(); },
    });
    const model = mountCombobox(byId('model-combobox'), {
      id: 'model-id', value: data.model ?? '', options: modelOptionsForCatalog(state.modelCatalogs[currentAdapter]),
      allowCustom: false, placeholder: 'Choose available LLM',
      onChange(value) { data.model = value; renderCanvas(); },
    });
    inspectorControls.push(adapter, model);
    const status = byId<HTMLElement>('model-status');
    void loadCatalog(currentAdapter, model, status);
    byId('refresh-models').addEventListener('click', () => void loadCatalog(adapterValue(state, data), model, status, true));
    inspector.querySelector<HTMLInputElement>('[data-field="alias"]')?.addEventListener('input', (event) => { data.alias = (event.target as HTMLInputElement).value; renderCanvas(); });
    if (!member) return;
    for (const input of inspector.querySelectorAll<HTMLInputElement>('[data-role]')) input.addEventListener('change', () => toggle(member.roles, input.dataset.role as string, input.checked));
    for (const input of inspector.querySelectorAll<HTMLInputElement>('[data-capability]')) input.addEventListener('change', () => toggle(member.capabilities, input.dataset.capability as string, input.checked));
    inspector.querySelector<HTMLInputElement>('[data-field="network"]')?.addEventListener('change', (event) => { member.requires_network = (event.target as HTMLInputElement).checked; });
    inspector.querySelector<HTMLInputElement>('[data-field="credentials"]')?.addEventListener('change', (event) => { member.requires_credentials = (event.target as HTMLInputElement).checked; });
    inspector.querySelector('#delete-member')?.addEventListener('click', actions.deleteSelected);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('.crew-node, .canvas-controls')) return;
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

  search.addEventListener('input', () => { state.search = search.value; renderCrewList(); });
  crewName.addEventListener('input', () => {
    if (!state.current) return;
    state.current.config.template.name = crewName.value;
    title.textContent = crewName.value || 'Untitled crew';
  });
  crewId.addEventListener('input', () => { if (state.current) state.current.config.template.id = crewId.value; });
  crewGroup.addEventListener('change', () => {
    if (!state.current) return;
    const groupVal = crewGroup.value || undefined;
    state.current.group = groupVal;
    state.current.config.template.group = groupVal;
    renderCrewList();
  });
  byId('new-crew').addEventListener('click', actions.newCrew);
  byId('new-group')?.addEventListener('click', () => { actions.newGroup?.(); });
  byId('add-member').addEventListener('click', actions.addMemberInternal);
  saveCrew.addEventListener('click', actions.saveCrew);
  deleteCrew.addEventListener('click', () => actions.deleteCrew());
  byId('fit-graph').addEventListener('click', () => {
    if (!state.current) return;
    state.viewport = fitViewport(nodeLayout(state.current), { width: canvas.clientWidth, height: canvas.clientHeight });
    applyViewport();
  });
  byId('reset-zoom').addEventListener('click', () => { state.viewport = resetViewport(); applyViewport(); });

  return (): void => {
    search.value = state.search;
    renderCrewList();
    renderMetadata();
    renderCanvas();
    renderInspector();
  };
}