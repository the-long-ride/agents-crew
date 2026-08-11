import { escapeHtml } from '../dom.js';
import { rescanTooltips } from '../components/tooltip.js';
import { chevronIcon, newCrewIcon, subGroupIcon, trashIcon } from '../components/icons.js';
import { groupLabel, isSubGroup, parentOf, subGroupsOf } from './group-utils.js';
import type { AppState, CrewRecord } from '../types.js';
import type { BuilderActions } from '../builder.js';

let toggleTimer: ReturnType<typeof setTimeout> | undefined;
let pendingToggleGroup: string | undefined;

export function renderRow(item: CrewRecord, state: AppState): string {
  const isSelected = state.current?.id === item.id && state.current.scope === item.scope;
  const canDelete = Boolean(item.path && item.scope !== 'builtin');
  const key = `${escapeHtml(item.scope)}:${escapeHtml(item.id)}`;
  return `<div class="list-row${isSelected ? ' selected' : ''}" data-crew="${key}" draggable="true">` +
    `<div class="list-row-select" data-select-crew="${key}" role="button" tabindex="0">` +
      `<span class="list-row-name">${escapeHtml(item.name)}</span>` +
      `<small>${escapeHtml(item.scope)}</small>` +
    `</div>` +
    (canDelete
      ? `<button type="button" class="list-row-delete" data-delete-crew="${key}" aria-label="Delete crew ${escapeHtml(item.name)}" data-tooltip="Delete ${escapeHtml(item.name)}" data-tooltip-position="right">` +
          trashIcon +
        `</button>`
      : '') +
  `</div>`;
}

function groupHeaderMarkup(groupName: string, count: number, isCollapsed: boolean, allowSubGroup: boolean, allowDelete: boolean): string {
  const tooltip = '"Click to collapse/expand; double-click to rename"';
  const headerRight =
    `<small>(${count})</small>` +
    `<button type="button" class="group-add-crew-button" data-add-to-group="${escapeHtml(groupName)}" aria-label="Add crew to ${escapeHtml(groupLabel(groupName))}" data-tooltip="Add a crew to this group" data-tooltip-position="right">${newCrewIcon}</button>` +
    (allowSubGroup
      ? `<button type="button" class="group-add-subgroup-button" data-add-subgroup="${escapeHtml(groupName)}" aria-label="Add sub-group to ${escapeHtml(groupLabel(groupName))}" data-tooltip="Add a sub-group under ${escapeHtml(groupLabel(groupName))}" data-tooltip-position="right">${subGroupIcon}</button>`
      : '') +
    (allowDelete
      ? `<button type="button" class="group-delete-button" data-delete-group="${escapeHtml(groupName)}" aria-label="Delete empty group ${escapeHtml(groupLabel(groupName))}" data-tooltip="Delete this empty group" data-tooltip-position="right">${trashIcon}</button>`
      : '');
  return `<div class="group-header">` +
    `<button type="button" class="group-header-toggle${isCollapsed ? ' collapsed' : ''}" data-group-toggle="${escapeHtml(groupName)}" aria-expanded="${!isCollapsed}">` +
      chevronIcon +
    `</button>` +
    `<span class="group-header-title" data-group-title="${escapeHtml(groupName)}" data-tooltip=${tooltip} data-tooltip-position="right">` +
      `<span>${escapeHtml(groupLabel(groupName))}</span>` +
    `</span>` +
    `<div class="group-header-right">${headerRight}</div>` +
  `</div>`;
}

export function renderCrewList(
  state: AppState,
  list: HTMLDivElement,
  actions: BuilderActions,
  renderMetadata: () => void,
): void {
  const query = state.search.trim().toLowerCase();
  // Filter by active scope: show the selected scope + builtin (always visible)
  const scopeFiltered = state.crews.filter((item) => item.scope === state.saveScope || item.scope === 'builtin');
  const filtered = query
    ? scopeFiltered.filter((item) => `${item.id} ${item.name} ${item.config.template?.group || item.group || ''}`.toLowerCase().includes(query))
    : scopeFiltered;

  if (!filtered.length) {
    list.innerHTML = `<div class="empty">No ${state.saveScope} crews${query ? ' matching your search' : ''}.</div>`;
    rescanTooltips();
    return;
  }

  const definedGroups = new Set<string>(state.groups || []);
  // Only include groups that have at least one crew in the scope-filtered set
  for (const item of scopeFiltered) {
    const g = item.config.template?.group || item.group;
    if (g) definedGroups.add(g);
  }
  for (const g of [...definedGroups]) {
    if (isSubGroup(g)) definedGroups.add(parentOf(g));
  }

  const rootGroups = [...definedGroups].filter((g) => !isSubGroup(g)).sort();
  const ungrouped: CrewRecord[] = [];
  const crewsForGroup = new Map<string, CrewRecord[]>();
  for (const g of definedGroups) crewsForGroup.set(g, []);
  for (const item of filtered) {
    const g = item.config.template?.group || item.group;
    if (g && crewsForGroup.has(g)) crewsForGroup.get(g)!.push(item);
    else if (g) crewsForGroup.set(g, [item]);
    else ungrouped.push(item);
  }

  let html = '';
  for (const rootGroup of rootGroups) {
    const directItems = crewsForGroup.get(rootGroup) ?? [];
    const subs = subGroupsOf(rootGroup, [...definedGroups]).sort();
    const isCollapsed = (state.collapsedGroups || []).includes(rootGroup);
    const directEmpty = directItems.length === 0;
    const subsEmpty = subs.every((s) => (crewsForGroup.get(s) ?? []).length === 0);
    const isGroupEmpty = directEmpty && subsEmpty;
    html += `<div class="group-section" data-drop-group="${escapeHtml(rootGroup)}">` +
      groupHeaderMarkup(rootGroup, directItems.length, isCollapsed, true, isGroupEmpty) +
      `<div class="group-items${isCollapsed ? ' collapsed' : ''}">` +
        (directItems.length
          ? directItems.map((item) => renderRow(item, state)).join('')
          : (subs.length ? '<div class="group-empty">No direct crews.</div>' : '<div class="group-empty">No crews in this group.</div>')) +
        subs.map((subName) => {
          const subItems = crewsForGroup.get(subName) ?? [];
          const subCollapsed = (state.collapsedGroups || []).includes(subName);
          return `<div class="sub-group-section" data-drop-group="${escapeHtml(subName)}">` +
            groupHeaderMarkup(subName, subItems.length, subCollapsed, false, subItems.length === 0) +
            `<div class="group-items${subCollapsed ? ' collapsed' : ''}">` +
              (subItems.length
                ? subItems.map((item) => renderRow(item, state)).join('')
                : '<div class="group-empty">No crews in this sub-group.</div>') +
            `</div>` +
          `</div>`;
        }).join('') +
      `</div>` +
    `</div>`;
  }

  if (ungrouped.length || rootGroups.length > 0) {
    if (rootGroups.length > 0) {
      const isCollapsed = (state.collapsedGroups || []).includes('__ungrouped__');
      html += `<div class="group-section" data-drop-group="__ungrouped__">` +
        `<div class="group-header">` +
        `<button type="button" class="group-header-toggle${isCollapsed ? ' collapsed' : ''}" data-group-toggle="__ungrouped__" aria-expanded="${!isCollapsed}">` +
          chevronIcon +
        `</button>` +
        `<span class="group-header-title">` +
          `<span>Ungrouped</span>` +
        `</span>` +
        `<div class="group-header-right"><small>(${ungrouped.length})</small></div>` +
        `</div>` +
        `<div class="group-items${isCollapsed ? ' collapsed' : ''}">` +
          ungrouped.map((item) => renderRow(item, state)).join('') +
        `</div>` +
      `</div>`;
    } else {
      html += `<div class="group-items">${ungrouped.map((item) => renderRow(item, state)).join('')}</div>`;
    }
  }

  list.innerHTML = html;
  rescanTooltips();

  for (const toggleBtn of list.querySelectorAll<HTMLButtonElement>('[data-group-toggle]')) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gName = toggleBtn.dataset.groupToggle!;
      if (pendingToggleGroup === gName) {
        clearTimeout(toggleTimer);
        pendingToggleGroup = undefined;
        return;
      }
      pendingToggleGroup = gName;
      toggleTimer = setTimeout(() => {
        pendingToggleGroup = undefined;
        state.collapsedGroups = state.collapsedGroups || [];
        if (state.collapsedGroups.includes(gName)) {
          state.collapsedGroups = state.collapsedGroups.filter((g) => g !== gName);
        } else {
          state.collapsedGroups.push(gName);
        }
        renderCrewList(state, list, actions, renderMetadata);
      }, 220);
    });
  }

  for (const titleContainer of list.querySelectorAll<HTMLElement>('.group-header-title')) {
    const toggleGroup = (): void => {
      const header = titleContainer.closest('.group-header');
      const toggleBtn = header?.querySelector<HTMLButtonElement>('[data-group-toggle]');
      toggleBtn?.click();
    };

    titleContainer.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      e.stopPropagation();
      toggleGroup();
    });

    const titleEl = titleContainer.querySelector<HTMLElement>('span:last-child');
    if (!titleEl) continue;

    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (toggleTimer) {
        clearTimeout(toggleTimer);
        toggleTimer = undefined;
      }
      pendingToggleGroup = undefined;

      const groupName = titleContainer.dataset.groupTitle;
      if (!groupName || groupName === '__ungrouped__') return;
      const oldName = groupName;
      const currentText = titleEl.textContent ?? '';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentText;
      input.className = 'input group-rename-input';
      input.style.cssText = 'font: 600 11px/1.2 var(--mono); padding: 2px 4px; width: 120px;';

      const stopProp = (evt: Event): void => evt.stopPropagation();
      input.addEventListener('click', stopProp);
      input.addEventListener('mousedown', stopProp);
      input.addEventListener('mouseup', stopProp);
      input.addEventListener('dblclick', stopProp);

      titleEl.replaceWith(input);
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);

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
        ke.stopPropagation();
        if (ke.key === 'Enter') { ke.preventDefault(); finish(); }
        else if (ke.key === 'Escape') { ke.preventDefault(); done = true; input.replaceWith(titleEl); }
      });
    });
  }

  for (const addToGroupBtn of list.querySelectorAll<HTMLButtonElement>('[data-add-to-group]')) {
    addToGroupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gName = addToGroupBtn.dataset.addToGroup!;
      actions.newCrewInGroup?.(gName);
    });
  }

  for (const addSubGroupBtn of list.querySelectorAll<HTMLButtonElement>('[data-add-subgroup]')) {
    addSubGroupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gName = addSubGroupBtn.dataset.addSubgroup!;
      actions.newSubGroup?.(gName);
    });
  }

  for (const deleteGroupBtn of list.querySelectorAll<HTMLButtonElement>('[data-delete-group]')) {
    deleteGroupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gName = deleteGroupBtn.dataset.deleteGroup!;
      actions.deleteGroup?.(gName);
    });
  }

  for (const selectBtn of list.querySelectorAll<HTMLElement>('[data-select-crew]')) {
    selectBtn.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const record = state.crews.find((item) => `${item.scope}:${item.id}` === selectBtn.dataset.selectCrew);
      if (record) actions.selectCrew(record);
    });
    selectBtn.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const record = state.crews.find((item) => `${item.scope}:${item.id}` === selectBtn.dataset.selectCrew);
        if (record) actions.selectCrew(record);
      }
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
      e.preventDefault();
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

      const stopProp = (evt: Event): void => evt.stopPropagation();
      input.addEventListener('click', stopProp);
      input.addEventListener('mousedown', stopProp);
      input.addEventListener('mouseup', stopProp);
      input.addEventListener('dblclick', stopProp);

      nameEl.replaceWith(input);
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);

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
        ke.stopPropagation();
        if (ke.key === 'Enter') { ke.preventDefault(); finish(); }
        else if (ke.key === 'Escape') { ke.preventDefault(); done = true; input.replaceWith(nameEl); }
      });
    });
  }

  let draggedCrewKey: string | null = null;

  for (const row of list.querySelectorAll<HTMLElement>('.list-row[draggable="true"]')) {
    row.addEventListener('dragstart', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || row.querySelector('input')) {
        e.preventDefault();
        return;
      }
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
        renderCrewList(state, list, actions, renderMetadata);
      })();
    });
  }
}
