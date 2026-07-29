import { addWorker, nodeLayout, normalizeTemplate, removeWorker, savePayload } from './app-model.js';

const state = { templates: [], runs: [], roles: [], capabilities: [], models: [], current: null, selected: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 2600);
}

function setView(name) {
  $$('.view').forEach(view => view.hidden = view.id !== `${name}-view`);
  $$('.nav-pill').forEach(button => button.classList.toggle('active', button.dataset.view === name));
}

function selectTemplate(record) {
  state.current = normalizeTemplate(record);
  state.selected = null;
  $('#canvas-title').textContent = state.current.config.template.name;
  renderAll();
}

function renderAll() {
  renderTemplateList();
  renderTemplateCards();
  renderCanvas();
  renderInspector();
  renderRuns();
}

function renderTemplateList() {
  const query = $('#template-search').value.toLowerCase();
  $('#template-list').innerHTML = state.templates
    .filter(item => `${item.id} ${item.name}`.toLowerCase().includes(query))
    .map(item => `<button class="list-row ${state.current?.id === item.id ? 'selected' : ''}" data-template="${escapeHtml(item.id)}"><span>${escapeHtml(item.name)}</span><small>${item.scope}</small></button>`)
    .join('');
  $$('[data-template]').forEach(button => button.onclick = () => {
    const record = state.templates.find(item => item.id === button.dataset.template);
    selectTemplate(record);
  });
}

function renderTemplateCards() {
  $('#template-cards').innerHTML = state.templates.map(item => `
    <article class="card">
      <p class="eyebrow">${item.scope}</p><h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.description || 'No description')}</p>
      <code>${escapeHtml(item.id)}</code>
      <button class="outline-pill" data-open-template="${escapeHtml(item.id)}">Open builder</button>
    </article>`).join('');
  $$('[data-open-template]').forEach(button => button.onclick = () => {
    selectTemplate(state.templates.find(item => item.id === button.dataset.openTemplate));
    setView('builder');
  });
}

function renderCanvas() {
  const canvas = $('#crew-canvas');
  if (!state.current) { canvas.innerHTML = '<div class="empty">No template selected.</div>'; return; }
  const nodes = nodeLayout(state.current);
  const manager = nodes[0];
  const lines = nodes.slice(1).map(node => `<line x1="${manager.x + 190}" y1="${manager.y + 54}" x2="${node.x}" y2="${node.y + 54}" />`).join('');
  canvas.innerHTML = `<svg class="edges" width="100%" height="100%">${lines}</svg>` + nodes.map(node => `
    <button class="crew-node ${node.type} ${state.selected?.id === node.id ? 'selected' : ''}" data-node="${escapeHtml(node.id)}" style="transform:translate(${node.x}px,${node.y}px)">
      <span class="node-kind">${node.type}</span>
      <strong>${escapeHtml(node.data.alias || node.id)}</strong>
      <small>${escapeHtml(node.type === 'manager' ? node.data.host : (node.data.adapter || node.data.kind))}</small>
      <code>${escapeHtml(node.data.model || 'host default')}</code>
    </button>`).join('');
  $$('.crew-node').forEach(node => {
    node.onclick = () => {
      if (node.dataset.node === 'manager') state.selected = { id: 'manager', type: 'manager' };
      else state.selected = { id: node.dataset.node, type: 'worker' };
      renderCanvas(); renderInspector();
    };
    makeDraggable(node);
  });
}

function selectedData() {
  if (!state.current || !state.selected) return null;
  if (state.selected.type === 'manager') return state.current.config.manager;
  return state.current.config.workers.find(worker => worker.id === state.selected.id);
}

function renderInspector() {
  const data = selectedData();
  $('#inspector-empty').hidden = !!data;
  $('#inspector').hidden = !data;
  if (!data) return;
  $('#field-alias').value = data.alias || '';
  $('#field-adapter').value = state.selected.type === 'manager' ? data.host : (data.adapter || data.kind || '');
  $('#field-model').value = data.model || '';
  $('#field-network').checked = !!data.requires_network;
  $('#field-credentials').checked = !!data.requires_credentials;
  $('#delete-node').hidden = state.selected.type === 'manager';
  renderChecks('#role-options', state.roles, data.roles || [], 'roles');
  renderChecks('#capability-options', state.capabilities, data.capabilities || [], 'capabilities');
}

function renderChecks(selector, values, selected, key) {
  $(selector).innerHTML = values.map(value => `<label><input type="checkbox" data-array="${key}" value="${value}" ${selected.includes(value) ? 'checked' : ''}> ${value}</label>`).join('');
  $$(`[data-array="${key}"]`).forEach(input => input.onchange = () => {
    const data = selectedData();
    data[key] = $$(`[data-array="${key}"]:checked`).map(item => item.value);
    renderCanvas();
  });
}

function bindInspector() {
  const update = (key, value) => { const data = selectedData(); if (!data) return; data[key] = value; renderCanvas(); };
  $('#field-alias').oninput = event => update('alias', event.target.value);
  $('#field-model').oninput = event => update('model', event.target.value);
  $('#field-adapter').oninput = event => update(state.selected?.type === 'manager' ? 'host' : 'adapter', event.target.value);
  $('#field-network').onchange = event => update('requires_network', event.target.checked);
  $('#field-credentials').onchange = event => update('requires_credentials', event.target.checked);
  $('#delete-node').onclick = () => {
    state.current = removeWorker(state.current, state.selected.id);
    state.selected = null;
    renderAll();
  };
}

function makeDraggable(node) {
  let start = null;
  node.onpointerdown = event => {
    start = { x: event.clientX, y: event.clientY, transform: node.style.transform };
    node.setPointerCapture(event.pointerId);
  };
  node.onpointermove = event => {
    if (!start) return;
    const match = start.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    const x = Number(match?.[1] || 0) + event.clientX - start.x;
    const y = Number(match?.[2] || 0) + event.clientY - start.y;
    node.style.transform = `translate(${Math.max(12, x)}px,${Math.max(12, y)}px)`;
  };
  node.onpointerup = () => {
    const match = node.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (match && state.current) {
      state.current.config.template.layout ??= {};
      state.current.config.template.layout[node.dataset.node] = { x: Math.round(Number(match[1])), y: Math.round(Number(match[2])) };
    }
    start = null;
    renderCanvas();
  };
}

function renderRuns() {
  $('#run-list').innerHTML = state.runs.length ? state.runs.map(run => `
    <button class="run-row" data-run="${escapeHtml(run.id)}">
      <span class="status-dot ${run.status}"></span>
      <span><strong>${escapeHtml(run.goal)}</strong><small>${run.status} · ${run.completed_tasks}/${run.total_tasks} tasks</small></span>
      <code>${escapeHtml(run.id.slice(0, 8))}</code>
    </button>`).join('') : '<div class="empty">No runs yet. Start one with <code>/agents-crew start &lt;template-id&gt;</code>.</div>';
  $$('[data-run]').forEach(button => button.onclick = () => loadRun(button.dataset.run));
}

async function loadRun(id) {
  const data = await api(`/api/runs/${encodeURIComponent(id)}`);
  const run = data.run;
  $('#run-detail').innerHTML = `
    <p class="eyebrow">${data.archived ? 'HISTORY' : 'ACTIVE RUN'}</p>
    <h3>${escapeHtml(run.original_goal)}</h3>
    <div class="metrics"><span>${run.status}</span><span>${run.iteration}/${run.max_iterations} iterations</span><span>${run.tasks ? Object.keys(run.tasks).length : 0} tasks</span></div>
    <h4>Current status</h4><p>${escapeHtml(run.terminal_summary || 'Run is progressing through durable task state.')}</p>
    <h4>Events</h4><div class="event-list">${data.events.slice().reverse().map(event => `<div><code>#${event.sequence}</code><span>${event.kind}</span><small>${new Date(event.timestamp).toLocaleString()}</small></div>`).join('') || '<p>None</p>'}</div>
    <h4>Durable files</h4><div class="file-list">${data.files.map(file => `<code>${escapeHtml(file)}</code>`).join('')}</div>`;
}

function newTemplate() {
  const base = normalizeTemplate(state.templates.find(item => item.id === 'default') || state.templates[0]);
  const id = `crew-${Date.now().toString(36)}`;
  base.id = id; base.name = 'New crew'; base.scope = 'global'; base.path = null;
  base.config.template = { id, name: 'New crew', description: '', layout: {} };
  selectTemplate(base);
}

async function saveCurrent() {
  if (!state.current) return;
  const metadata = state.current.config.template;
  const name = prompt('Template name', metadata.name);
  if (!name) return;
  const id = prompt('Template ID (lowercase slug)', metadata.id);
  if (!id) return;
  metadata.id = id; metadata.name = name;
  try {
    const saved = await api(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(savePayload(state.current, $('#save-scope').value))
    });
    const index = state.templates.findIndex(item => item.id === saved.id && item.scope === saved.scope);
    if (index >= 0) state.templates[index] = saved; else state.templates.push(saved);
    selectTemplate(saved); toast('Template saved');
  } catch (error) { toast(error.message); }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

async function init() {
  const bootstrap = await api('/api/bootstrap');
  state.templates = bootstrap.templates;
  state.runs = bootstrap.runs;
  state.roles = bootstrap.roles;
  state.capabilities = bootstrap.capabilities;
  state.models = bootstrap.model_presets;
  $('#model-presets').innerHTML = state.models.map(model => `<option value="${escapeHtml(model)}">`).join('');
  selectTemplate(state.templates[0]);
  bindInspector();
  $$('.nav-pill').forEach(button => button.onclick = () => setView(button.dataset.view));
  $('#template-search').oninput = renderTemplateList;
  $('#new-template').onclick = newTemplate;
  $('#add-worker').onclick = () => { state.current = addWorker(state.current); renderAll(); };
  $('#save-template').onclick = saveCurrent;
}

init().catch(error => toast(error.message));
