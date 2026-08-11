import { byId, escapeHtml } from './dom.js';
import type { ConnectionStatus } from './types.js';

export type ConnectionAction = 'connect' | 'check' | 'repair' | 'disconnect';
export interface ConnectionActions { control(host: string, action: ConnectionAction): Promise<void> }

const hostNames: Record<string, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  opencode: 'OpenCode',
  antigravity: 'Antigravity',
};

function actionButtons(status: ConnectionStatus): string {
  const actions: ConnectionAction[] = status.status === 'missing' ? ['connect', 'check']
    : status.status === 'connected' ? ['check', 'disconnect']
      : status.status === 'modified' ? ['repair', 'check', 'disconnect'] : ['check'];
  return actions.map((action) => `<button type="button" class="${action === 'disconnect' ? 'danger-button' : action === 'connect' || action === 'repair' ? 'primary-button' : 'secondary-button'}" data-connection-action="${action}" aria-label="${action} ${escapeHtml(hostNames[status.host] ?? status.host)} global connection">${action[0]?.toUpperCase()}${action.slice(1)}</button>`).join('');
}

export function connectMarkup(statuses: ConnectionStatus[]): string {
  if (!statuses.length) return '<div class="empty">No host connection data available.</div>';
  return statuses.map((status) => {
    const changed = status.files.filter((file) => file.action !== 'ok' && file.action !== 'missing');
    const detail = status.message ?? (status.status === 'connected'
      ? `${status.files.length} generated files are current.`
      : status.status === 'missing' ? 'No Agents Crew global wiring is installed.'
        : changed[0]?.message ?? 'Generated files need attention.');
    return `<article class="connection-card" data-connect-host="${escapeHtml(status.host)}">
      <div class="connection-card-head">
        <div><p class="eyebrow">Global scope</p><h3>${escapeHtml(hostNames[status.host] ?? status.host)}</h3></div>
        <span class="connection-status ${escapeHtml(status.status)}">${escapeHtml(status.status)}</span>
      </div>
      <p>${escapeHtml(detail)}</p>
      ${changed.length ? `<code class="connection-path">${escapeHtml(changed[0]?.path ?? '')}</code>` : ''}
      <div class="table-actions">${actionButtons(status)}</div>
    </article>`;
  }).join('');
}

export function renderConnectView(containerId: string, statuses: ConnectionStatus[], actions: ConnectionActions): void {
  const container = byId<HTMLDivElement>(containerId);
  container.innerHTML = connectMarkup(statuses);
  for (const card of container.querySelectorAll<HTMLElement>('[data-connect-host]')) {
    const host = card.dataset.connectHost as string;
    for (const button of card.querySelectorAll<HTMLButtonElement>('[data-connection-action]')) {
      button.addEventListener('click', () => void actions.control(host, button.dataset.connectionAction as ConnectionAction));
    }
  }
}
