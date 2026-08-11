import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRow } from '../../dist/ui/assets/builder/crew-list.js';
import { resizeSidebarWidth } from '../../dist/ui/assets/components/sidebar-resizer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stub so rescanTooltips() inside renderCrewList does not throw. */
function stubDocument() {
  const priorDocument = globalThis.document;
  const priorWindow = globalThis.window;
  globalThis.document = {
    documentElement: { dataset: {}, style: {} },
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      className: '',
      innerHTML: '',
      textContent: '',
      hidden: false,
      isConnected: false,
      setAttribute() {},
      getAttribute() { return null; },
      append() {},
      remove() {},
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
    }),
    body: { append() {}, querySelectorAll: () => [] },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = { innerWidth: 1280, innerHeight: 800 };
  return () => {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  };
}

/** Create a minimal fake list div that captures innerHTML writes. */
function fakeList() {
  let content = '';
  return {
    get innerHTML() { return content; },
    set innerHTML(v) { content = v; },
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

/** Minimal crew record factory. */
function crew(overrides = {}) {
  return {
    id: 'test-crew',
    name: 'Test Crew',
    description: '',
    scope: 'global',
    path: '/some/path/test-crew.toml',
    group: undefined,
    config: { template: { id: 'test-crew', name: 'Test Crew', description: '', layout: {} }, workers: [] },
    ...overrides,
  };
}

/** Minimal AppState factory. */
function state(overrides = {}) {
  return {
    crews: [],
    current: null,
    saveScope: 'global',
    search: '',
    groups: [],
    collapsedGroups: [],
    ...overrides,
  };
}

async function renderCrewList(s, list, actions = {}, renderMetadata = () => {}) {
  const { renderCrewList: fn } = await import('../../dist/ui/assets/builder/crew-list.js');
  return fn(s, list, actions, renderMetadata);
}

// ---------------------------------------------------------------------------
// renderRow — accessible markup
// ---------------------------------------------------------------------------

test('renderRow uses div[role=button] not a native button for row select', () => {
  const s = state({ current: null });
  const html = renderRow(crew(), s);
  assert.match(html, /class="list-row-select"[^>]*role="button"/u);
  assert.doesNotMatch(html, /<button[^>]*class="list-row-select"/u);
});

test('renderRow marks selected crew with selected class', () => {
  const record = crew({ id: 'alpha', scope: 'global' });
  const s = state({ current: { id: 'alpha', scope: 'global' } });
  assert.match(renderRow(record, s), /class="list-row selected"/u);
});

test('renderRow does not mark unselected crew as selected', () => {
  const record = crew({ id: 'alpha', scope: 'global' });
  const s = state({ current: { id: 'beta', scope: 'global' } });
  assert.doesNotMatch(renderRow(record, s), /class="list-row selected"/u);
});

test('renderRow shows delete button only for writable crews with a path', () => {
  const writable = crew({ id: 'w', scope: 'global', path: '/w.toml' });
  const builtin = crew({ id: 'b', scope: 'builtin', path: undefined });
  const s = state();
  assert.match(renderRow(writable, s), /data-delete-crew="global:w"/u);
  assert.doesNotMatch(renderRow(builtin, s), /data-delete-crew/u);
});

test('renderRow shows scope label in small element', () => {
  const record = crew({ scope: 'workspace' });
  const html = renderRow(record, state());
  assert.match(html, /<small>workspace<\/small>/u);
});

test('renderRow escapes dangerous characters in name', () => {
  const record = crew({ id: 'xss', name: '<script>alert(1)</script>', scope: 'global' });
  const html = renderRow(record, state());
  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /&lt;script&gt;/u);
});

// ---------------------------------------------------------------------------
// renderCrewList — scope filtering
// ---------------------------------------------------------------------------

test('renderCrewList shows only global crews when saveScope is global', async () => {
  const restore = stubDocument();
  try {
    const list = fakeList();
    const globalCrew = crew({ id: 'g', scope: 'global', name: 'Global Crew' });
    const workspaceCrew = crew({ id: 'w', scope: 'workspace', name: 'Workspace Crew' });
    const s = state({ crews: [globalCrew, workspaceCrew], saveScope: 'global' });
    await renderCrewList(s, list);
    assert.match(list.innerHTML, /Global Crew/u);
    assert.doesNotMatch(list.innerHTML, /Workspace Crew/u);
  } finally { restore(); }
});

test('renderCrewList shows only workspace crews when saveScope is workspace', async () => {
  const restore = stubDocument();
  try {
    const list = fakeList();
    const globalCrew = crew({ id: 'g', scope: 'global', name: 'Global Crew' });
    const workspaceCrew = crew({ id: 'w', scope: 'workspace', name: 'Workspace Crew' });
    const s = state({ crews: [globalCrew, workspaceCrew], saveScope: 'workspace' });
    await renderCrewList(s, list);
    assert.doesNotMatch(list.innerHTML, /Global Crew/u);
    assert.match(list.innerHTML, /Workspace Crew/u);
  } finally { restore(); }
});

test('renderCrewList always shows builtin crews in global scope', async () => {
  const restore = stubDocument();
  try {
    const list = fakeList();
    const builtinCrew = crew({ id: 'default', scope: 'builtin', path: undefined, name: 'Default' });
    const workspaceCrew = crew({ id: 'w', scope: 'workspace', name: 'Workspace Crew' });
    const s = state({ crews: [builtinCrew, workspaceCrew], saveScope: 'global' });
    await renderCrewList(s, list);
    assert.match(list.innerHTML, /Default/u);
    assert.doesNotMatch(list.innerHTML, /Workspace Crew/u);
  } finally { restore(); }
});

test('renderCrewList always shows builtin crews in workspace scope', async () => {
  const restore = stubDocument();
  try {
    const list = fakeList();
    const builtinCrew = crew({ id: 'default', scope: 'builtin', path: undefined, name: 'Default' });
    const workspaceCrew = crew({ id: 'w', scope: 'workspace', name: 'Workspace Crew' });
    const s = state({ crews: [builtinCrew, workspaceCrew], saveScope: 'workspace' });
    await renderCrewList(s, list);
    assert.match(list.innerHTML, /Default/u);
    assert.match(list.innerHTML, /Workspace Crew/u);
  } finally { restore(); }
});

test('renderCrewList shows scoped empty message when no matching scope crews', async () => {
  const restore = stubDocument();
  try {
    const list = fakeList();
    const workspaceCrew = crew({ id: 'w', scope: 'workspace', name: 'Workspace Crew' });
    const s = state({ crews: [workspaceCrew], saveScope: 'global' });
    await renderCrewList(s, list);
    assert.match(list.innerHTML, /No global crews/u);
  } finally { restore(); }
});

test('renderCrewList empty message includes search context', async () => {
  const restore = stubDocument();
  try {
    const list = fakeList();
    const workspaceCrew = crew({ id: 'w', scope: 'workspace', name: 'Workspace Crew' });
    const s = state({ crews: [workspaceCrew], saveScope: 'global', search: 'something' });
    await renderCrewList(s, list);
    assert.match(list.innerHTML, /No global crews matching your search/u);
  } finally { restore(); }
});

test('renderCrewList workspace scope empty message uses correct label', async () => {
  const restore = stubDocument();
  try {
    const list = fakeList();
    const s = state({ crews: [], saveScope: 'workspace' });
    await renderCrewList(s, list);
    assert.match(list.innerHTML, /No workspace crews/u);
  } finally { restore(); }
});

test('renderCrewList scope filter combines with search filter', async () => {
  const restore = stubDocument();
  try {
    const list = fakeList();
    const g1 = crew({ id: 'alpha', scope: 'global', name: 'Alpha' });
    const g2 = crew({ id: 'beta', scope: 'global', name: 'Beta' });
    const w1 = crew({ id: 'gamma', scope: 'workspace', name: 'Gamma' });
    const s = state({ crews: [g1, g2, w1], saveScope: 'global', search: 'alpha' });
    await renderCrewList(s, list);
    assert.match(list.innerHTML, /Alpha/u);
    assert.doesNotMatch(list.innerHTML, /Beta/u);
    assert.doesNotMatch(list.innerHTML, /Gamma/u);
  } finally { restore(); }
});

test('renderCrewList excludes groups derived from out-of-scope crews but shows user-defined groups', async () => {
  const restore = stubDocument();
  try {
    const list = fakeList();
    // WorkspaceDerived: a group that exists ONLY because a workspace crew declares it
    // (not in state.groups). When scope=global, this group must not appear.
    const wsCrewInGroup = crew({
      id: 'wg', scope: 'workspace', name: 'WS In Group', group: 'WorkspaceDerived',
      config: { template: { id: 'wg', name: 'WS In Group', description: '', group: 'WorkspaceDerived', layout: {} }, workers: [] },
    });
    const globalCrew = crew({ id: 'gng', scope: 'global', name: 'Global No Group' });
    // state.groups is empty — group only came from the workspace crew
    const s = state({ crews: [wsCrewInGroup, globalCrew], saveScope: 'global', groups: [] });
    await renderCrewList(s, list);
    // The workspace-derived group must NOT appear when scope=global (it wasn't in state.groups
    // and no global crew belongs to it)
    assert.doesNotMatch(list.innerHTML, /WorkspaceDerived/u);
    // The global crew still appears
    assert.match(list.innerHTML, /Global No Group/u);
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// group-header-title markup — nested span for text-overflow ellipsis
// ---------------------------------------------------------------------------

test('group header title renders nested span wrapping label text', async () => {
  const restore = stubDocument();
  try {
    const list = fakeList();
    const groupedCrew = crew({
      id: 'gc', scope: 'global', name: 'Grouped', group: 'LongGroupName',
      config: { template: { id: 'gc', name: 'Grouped', description: '', group: 'LongGroupName', layout: {} }, workers: [] },
    });
    const s = state({ crews: [groupedCrew], saveScope: 'global', groups: ['LongGroupName'] });
    await renderCrewList(s, list);
    // group-header-title must wrap its label in a child <span> — the CSS
    // text-overflow ellipsis rule targets .group-header-title > span
    assert.match(list.innerHTML, /class="group-header-title"[^>]*>[\s\S]*?<span>/u);
    assert.match(list.innerHTML, />LongGroupName</u);
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// Left sidebar min-width — resizeSidebarWidth
// ---------------------------------------------------------------------------

test('left sidebar never shrinks below 260px', () => {
  assert.equal(resizeSidebarWidth(280, -200, 'left'), 260);
  assert.equal(resizeSidebarWidth(260, -1, 'left'), 260);
  assert.equal(resizeSidebarWidth(260, -100, 'left'), 260);
});

test('left sidebar grows correctly and caps at 500px', () => {
  assert.equal(resizeSidebarWidth(280, 100, 'left'), 380);
  assert.equal(resizeSidebarWidth(450, 100, 'left'), 500);
  assert.equal(resizeSidebarWidth(499, 2, 'left'), 500);
});

test('right sidebar shrinks when dragging right (positive delta decreases width)', () => {
  // For right sidebar, direction=-1: width = startWidth + delta*(-1)
  // Positive delta (dragging right) decreases right sidebar width
  assert.equal(resizeSidebarWidth(330, 80, 'right'), 250);
  assert.equal(resizeSidebarWidth(300, 120, 'right'), 200); // clamped at 200
  assert.equal(resizeSidebarWidth(200, 50, 'right'), 200);  // already at min, stays at 200
});

test('left and right sidebar have distinct minimum widths', () => {
  // Left min=260: dragging 100px left from 280 is clamped to 260
  assert.equal(resizeSidebarWidth(280, -100, 'left'), 260);
  // Right min=200: dragging 100px right from 300 yields 200
  assert.equal(resizeSidebarWidth(300, 100, 'right'), 200);
  // Left floor is higher than right floor
  assert.ok(260 > 200);
});
