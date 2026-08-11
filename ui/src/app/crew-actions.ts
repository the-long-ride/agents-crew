import { requestJson } from '../api.js';
import { resetViewport } from '../graph/viewport.js';
import { modelIsAvailable } from '../builder.js';
import { confirmDialog } from '../components/dialog.js';
import { normalizeCrew, savePayload } from '../model.js';
import type { AppState, CrewRecord, MemberConfig, ModelCatalogResponse } from '../types.js';

function memberAdapter(member: MemberConfig): string {
  return member.adapter ?? member.provider ?? member.host ?? member.kind;
}

export const crewActions = (
  state: AppState,
  toast: (message: string) => void,
  storeGroups: () => void,
  render: () => void,
  loadModels: (host: string, refresh?: boolean) => Promise<ModelCatalogResponse>,
) => {
  async function validateCurrentModels(record: CrewRecord): Promise<string | undefined> {
    const entries = [
      { label: 'Boss', adapter: record.config.manager.host, model: record.config.manager.model },
      ...record.config.workers.map((member) => ({
        label: member.alias || member.id,
        adapter: memberAdapter(member),
        model: member.model,
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

  async function saveCrew(): Promise<void> {
    if (!state.current) return;
    const metadata = state.current.config.template;
    metadata.name = metadata.name.trim();
    metadata.id = metadata.id.trim();
    if (!metadata.name) { toast('Crew name is required'); return; }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(metadata.id)) {
      toast('Crew ID must be a lowercase slug');
      return;
    }
    const previous = { id: state.current.id, scope: state.current.scope, path: state.current.path };
    try {
      const invalidModel = await validateCurrentModels(state.current);
      if (invalidModel) { toast(invalidModel); return; }
      const saved = await requestJson<CrewRecord>(`/api/templates/${encodeURIComponent(metadata.id)}`, {
        method: 'PUT', body: JSON.stringify(savePayload(state.current, state.saveScope)),
      });
      let cleanupFailed = false;
      if (previous.path && previous.scope !== 'builtin' && (previous.id !== saved.id || previous.scope !== saved.scope)) {
        try {
          await requestJson(`/api/templates/${encodeURIComponent(previous.id)}?scope=${encodeURIComponent(previous.scope)}`, { method: 'DELETE' });
        } catch { cleanupFailed = true; }
      }
      state.crews = await requestJson<CrewRecord[]>('/api/templates');
      state.current = normalizeCrew(saved);
      state.selected = null;
      toast(cleanupFailed ? 'Crew saved; old crew could not be removed' : 'Crew saved');
      render();
    } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
  }

  async function deleteCrew(record: CrewRecord | null = state.current): Promise<void> {
    if (!record || record.scope === 'builtin' || !record.path) return;
    const confirmed = await confirmDialog({
      title: 'Delete crew',
      message: `Are you sure you want to delete crew "${record.name}" (${record.scope})? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await requestJson(`/api/templates/${encodeURIComponent(record.id)}?scope=${encodeURIComponent(record.scope)}`, { method: 'DELETE' });
      state.crews = await requestJson<CrewRecord[]>('/api/templates');
      if (state.current?.id === record.id && state.current.scope === record.scope) {
        const replacement = state.crews.find((item) => item.id === record.id) ?? state.crews[0];
        state.current = replacement ? normalizeCrew(replacement) : null;
        state.selected = null;
        state.viewport = resetViewport();
      }
      toast('Crew deleted');
      render();
    } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
  }

  async function moveCrewGroup(record: CrewRecord, group: string | undefined): Promise<boolean> {
    if (record.scope === 'builtin' || !record.path) {
      toast('Built-in crews cannot be reassigned');
      return false;
    }
    const config = structuredClone(record.config);
    config.template.group = group;
    try {
      await requestJson<CrewRecord>(`/api/templates/${encodeURIComponent(record.id)}`, {
        method: 'PUT', body: JSON.stringify({ scope: record.scope, config }),
      });
      state.crews = await requestJson<CrewRecord[]>('/api/templates');
      if (state.current?.id === record.id && state.current.scope === record.scope) {
        state.current = normalizeCrew(state.crews.find((item) => item.id === record.id && item.scope === record.scope) ?? record);
      }
      render();
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function renameCrew(record: CrewRecord, newName: string): Promise<boolean> {
    if (record.scope === 'builtin' || !record.path) {
      toast('Built-in crews cannot be renamed');
      return false;
    }
    try {
      const config = structuredClone(record.config);
      config.template.name = newName;
      await requestJson<CrewRecord>(`/api/templates/${encodeURIComponent(record.id)}`, {
        method: 'PUT', body: JSON.stringify({ scope: record.scope, config }),
      });
      state.crews = await requestJson<CrewRecord[]>('/api/templates');
      if (state.current?.id === record.id && state.current.scope === record.scope) {
        state.current = normalizeCrew(state.crews.find((item) => item.id === record.id && item.scope === record.scope) ?? record);
      }
      render();
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function renameGroup(oldName: string, newName: string): Promise<boolean> {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return false;
    const isSub = oldName.includes('/');
    const parent = isSub ? oldName.slice(0, oldName.indexOf('/')) : '';
    const finalName = isSub ? `${parent}/${trimmed}` : trimmed;
    if (finalName === oldName) return false;
    if ((state.groups || []).includes(finalName)) { toast(`Group "${finalName}" already exists`); return false; }
    for (const record of state.crews) {
      const g = record.config.template?.group || record.group;
      if (g === oldName && record.scope !== 'builtin' && record.path) {
        const config = structuredClone(record.config);
        config.template.group = finalName;
        await requestJson(`/api/templates/${encodeURIComponent(record.id)}`, {
          method: 'PUT', body: JSON.stringify({ scope: record.scope, config }),
        });
      }
    }
    state.crews = await requestJson<CrewRecord[]>('/api/templates');
    state.groups = (state.groups || []).map((g) => (g === oldName ? finalName : g));
    storeGroups();
    state.collapsedGroups = (state.collapsedGroups || []).map((g) => (g === oldName ? finalName : g));
    for (const record of state.crews) {
      if ((record.config.template?.group || record.group) === oldName) {
        record.group = finalName;
        record.config.template.group = finalName;
      }
    }
    if (state.current && (state.current.config.template?.group || state.current.group) === oldName) {
      state.current.group = finalName;
      state.current.config.template.group = finalName;
    }
    toast(`Group renamed to "${isSub ? trimmed : finalName}"`);
    render();
    return true;
  }

  return { saveCrew, deleteCrew, moveCrewGroup, renameCrew, renameGroup };
};

export { memberAdapter as adapterLabel };