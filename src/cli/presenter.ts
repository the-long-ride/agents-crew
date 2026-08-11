interface PresentOptions { color: boolean }
interface StyleSet {
  dim(value: string): string;
  cyan(value: string): string;
  green(value: string): string;
  yellow(value: string): string;
  red(value: string): string;
}

type RecordValue = Record<string, unknown>;

function style(options: PresentOptions): StyleSet {
  const wrap = (code: number) => (value: string): string => options.color ? `\u001b[${code}m${value}\u001b[0m` : value;
  return { dim: wrap(2), cyan: wrap(36), green: wrap(32), yellow: wrap(33), red: wrap(31) };
}

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
}
function string(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function bool(value: unknown): boolean { return value === true; }
function heading(name: string, s: StyleSet): string { return s.cyan(`◆ Agents Crew · ${name}`); }
function success(message: string, s: StyleSet): string { return `${s.green('✓')} ${message}`; }
function warning(message: string, s: StyleSet): string { return `${s.yellow('!')} ${message}`; }
function failure(message: string, s: StyleSet): string { return `${s.red('✗')} ${message}`; }
function paused(message: string, s: StyleSet): string { return `${s.yellow('‖')} ${message}`; }
function info(message: string, s: StyleSet): string { return `${s.cyan('•')} ${message}`; }
function line(level: number, value: string): string { return `${'  '.repeat(level)}${value}`; }
function basename(path: string): string { return path.replaceAll('\\', '/').split('/').at(-1) ?? path; }

function renderRun(value: RecordValue, s: StyleSet): string | undefined {
  const run = record(value.run);
  if (!run || typeof run.id !== 'string' || typeof run.status !== 'string') return undefined;
  const status = run.status;
  const statusLine = status === 'paused' ? paused(status, s)
    : ['completed'].includes(status) ? success(status, s)
      : ['failed', 'cancelled', 'blocked'].includes(status) ? failure(status, s)
        : info(status, s);
  const lines = [heading('run', s), '', line(1, statusLine), line(1, `${s.dim('ID')} ${run.id}`)];
  if (typeof run.iteration === 'number' && typeof run.max_iterations === 'number') lines.push(line(1, `${s.dim('Iteration')} ${run.iteration}/${run.max_iterations}`));
  if (typeof run.original_goal === 'string') lines.push('', line(1, 'Goal'), line(2, run.original_goal));
  if (typeof run.terminal_summary === 'string' && run.terminal_summary) lines.push('', line(1, 'Summary'), line(2, run.terminal_summary));
  const pending = Array.isArray(value.pending_actions) ? value.pending_actions.length : 0;
  if (pending) lines.push('', line(1, warning(`${pending} pending action${pending === 1 ? '' : 's'}`, s)));
  return lines.join('\n');
}

function renderDoctor(value: RecordValue, s: StyleSet): string | undefined {
  if (!('config_valid' in value) || !Array.isArray(value.workers)) return undefined;
  const lines = [heading('doctor', s), '', line(1, 'Environment')];
  lines.push(line(2, bool(value.config_valid) ? success('Config valid', s) : failure(`Config invalid${value.config_error ? ` · ${string(value.config_error)}` : ''}`, s)));
  if (value.binary_version) lines.push(line(2, `${s.dim('Agents Crew')} ${string(value.binary_version)}`));
  if (value.runtime) lines.push(line(2, `${s.dim('Node')} ${string(value.runtime)}`));
  lines.push('', line(1, 'Workers'));
  for (const raw of value.workers) {
    const worker = record(raw) ?? {};
    const detail = [string(worker.id, 'unknown'), string(worker.kind, 'worker'), string(worker.model)].filter(Boolean).join('  ');
    const message = string(worker.message);
    lines.push(line(2, bool(worker.available) ? success(detail, s) : warning(`${detail}${message ? `  ${message}` : ''}`, s)));
  }
  const git = record(value.git);
  lines.push('', line(1, 'Git'));
  if (git?.root) lines.push(line(2, success(string(git.root), s)));
  else if (git?.error) lines.push(line(2, warning(string(git.error), s)));
  else lines.push(line(2, warning('Unavailable', s)));
  if (typeof value.credentials === 'string') lines.push('', line(1, s.dim(value.credentials)));
  return lines.join('\n');
}

function renderPlugin(value: RecordValue, s: StyleSet): string | undefined {
  if (typeof value.host !== 'string' || !Array.isArray(value.files)) return undefined;
  const lines = [heading(value.host, s), '', line(1, 'Files')];
  for (const raw of value.files) {
    const file = record(raw) ?? {};
    const action = string(file.action);
    const path = string(file.path);
    const message = string(file.message);
    const label = `${basename(path)}${message ? `  ${s.dim(message)}` : ''}`;
    const marker = ['created', 'updated', 'installed', 'removed', 'ok', 'owned'].includes(action) ? success(label, s)
      : ['modified', 'preserve', 'missing'].includes(action) ? warning(label, s)
        : action === 'error' ? failure(label, s) : info(label, s);
    lines.push(line(2, marker));
  }
  return lines.join('\n');
}

function renderInit(value: RecordValue, s: StyleSet): string | undefined {
  if (value.initialized !== true || typeof value.config !== 'string') return undefined;
  const lines = [heading('initialized', s), '', line(1, success('Configuration', s)), line(2, value.config)];
  if (Array.isArray(value.next) && value.next.length) {
    lines.push('', line(1, 'Next'));
    for (const item of value.next) lines.push(line(2, `${s.cyan('›')} ${String(item)}`));
  }
  return lines.join('\n');
}

function renderSimple(value: RecordValue, s: StyleSet): string | undefined {
  if (value.valid === true && Object.keys(value).length === 1) return `${heading('config', s)}\n\n${line(1, success('Configuration valid', s))}`;
  if (Array.isArray(value.hosts)) return `${heading('hosts', s)}\n\n${value.hosts.map((host) => line(1, `${s.cyan('•')} ${String(host)}`)).join('\n')}`;
  if (value.status === 'paused' || value.status === 'cancelled') return `${heading('run control', s)}\n\n${line(1, value.status === 'paused' ? paused('paused', s) : failure('cancelled', s))}`;
  return undefined;
}

export function presentHuman(value: unknown, options: PresentOptions): string {
  if (typeof value === 'string') return value;
  const object = record(value);
  if (!object) return JSON.stringify(value, null, 2);
  const s = style(options);
  return renderRun(object, s) ?? renderDoctor(object, s) ?? renderPlugin(object, s) ?? renderInit(object, s) ?? renderSimple(object, s) ?? JSON.stringify(value, null, 2);
}

export function presentError(message: string, options: PresentOptions): string {
  return failure(message, style(options));
}
