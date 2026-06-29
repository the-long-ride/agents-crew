type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
export type TomlDocument = { [key: string]: TomlValue };

function stripComment(line: string): string {
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && character === '\\') { escaped = true; continue; }
    if (character === '"' || character === "'") {
      if (quote === character) quote = undefined;
      else if (!quote) quote = character;
      continue;
    }
    if (character === '#' && !quote) return line.slice(0, index);
  }
  return line;
}

function splitTopLevel(value: string, separator = ','): string[] {
  const output: string[] = [];
  let start = 0;
  let square = 0;
  let curly = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && character === '\\') { escaped = true; continue; }
    if (character === '"' || character === "'") {
      if (quote === character) quote = undefined;
      else if (!quote) quote = character;
      continue;
    }
    if (quote) continue;
    if (character === '[') square += 1;
    else if (character === ']') square -= 1;
    else if (character === '{') curly += 1;
    else if (character === '}') curly -= 1;
    else if (character === separator && square === 0 && curly === 0) {
      output.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  output.push(value.slice(start).trim());
  return output.filter(Boolean);
}

function findEquals(value: string): number {
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && character === '\\') { escaped = true; continue; }
    if (character === '"' || character === "'") {
      if (quote === character) quote = undefined;
      else if (!quote) quote = character;
      continue;
    }
    if (character === '=' && !quote) return index;
  }
  return -1;
}

function parseString(value: string): string {
  if (value.startsWith('"')) return JSON.parse(value) as string;
  return value.slice(1, -1).replaceAll("''", "'");
}

function parseValue(value: string): TomlValue {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return parseString(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^[+-]?\d+$/u.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/u.test(trimmed)) return Number.parseFloat(trimmed);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return splitTopLevel(trimmed.slice(1, -1)).map(parseValue);
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const object: { [key: string]: TomlValue } = {};
    for (const item of splitTopLevel(trimmed.slice(1, -1))) {
      const equals = findEquals(item);
      if (equals < 0) throw new Error(`invalid inline TOML entry: ${item}`);
      const key = item.slice(0, equals).trim().replace(/^['"]|['"]$/gu, '');
      object[key] = parseValue(item.slice(equals + 1));
    }
    return object;
  }
  throw new Error(`unsupported TOML value: ${trimmed}`);
}

function resolveSection(root: TomlDocument, parts: string[]): { [key: string]: TomlValue } {
  let current: { [key: string]: TomlValue } = root;
  for (const rawPart of parts) {
    const part = rawPart.replace(/^['"]|['"]$/gu, '');
    const existing = current[part];
    if (Array.isArray(existing)) {
      const last = existing.at(-1);
      if (!last || Array.isArray(last) || typeof last !== 'object') throw new Error(`invalid table path ${parts.join('.')}`);
      current = last;
      continue;
    }
    if (existing === undefined) current[part] = {};
    const value = current[part];
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`invalid table path ${parts.join('.')}`);
    current = value;
  }
  return current;
}

export function parseToml(text: string): TomlDocument {
  const root: TomlDocument = {};
  let current: { [key: string]: TomlValue } = root;
  const lines = text.replace(/\r\n/gu, '\n').split('\n');
  let pending = '';
  for (const raw of lines) {
    const cleaned = stripComment(raw).trim();
    if (!cleaned && !pending) continue;
    pending = pending ? `${pending} ${cleaned}` : cleaned;
    const opens = (pending.match(/[\[{]/gu) ?? []).length;
    const closes = (pending.match(/[\]}]/gu) ?? []).length;
    const quoteCount = (pending.match(/(?<!\\)"/gu) ?? []).length;
    if (opens > closes || quoteCount % 2 !== 0) continue;
    const line = pending;
    pending = '';
    if (line.startsWith('[[') && line.endsWith(']]')) {
      const parts = line.slice(2, -2).trim().split('.');
      const parent = resolveSection(root, parts.slice(0, -1));
      const key = parts.at(-1)?.replace(/^['"]|['"]$/gu, '');
      if (!key) throw new Error(`invalid array table: ${line}`);
      if (parent[key] === undefined) parent[key] = [];
      if (!Array.isArray(parent[key])) throw new Error(`array table collides with value: ${key}`);
      const item: { [key: string]: TomlValue } = {};
      (parent[key] as TomlValue[]).push(item);
      current = item;
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      current = resolveSection(root, line.slice(1, -1).trim().split('.'));
      continue;
    }
    const equals = findEquals(line);
    if (equals < 0) throw new Error(`invalid TOML assignment: ${line}`);
    const key = line.slice(0, equals).trim().replace(/^['"]|['"]$/gu, '');
    current[key] = parseValue(line.slice(equals + 1));
  }
  if (pending) throw new Error('unterminated TOML value');
  return root;
}

function quoteKey(key: string): string { return /^[A-Za-z0-9_-]+$/u.test(key) ? key : JSON.stringify(key); }
function formatValue(value: TomlValue): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  return `{ ${Object.entries(value).map(([key, item]) => `${quoteKey(key)} = ${formatValue(item)}`).join(', ')} }`;
}

export function stringifyToml(document: TomlDocument): string {
  const lines: string[] = [];
  const scalarEntries = Object.entries(document).filter(([, value]) => typeof value !== 'object' || value === null || (Array.isArray(value) && !value.some((item) => item !== null && typeof item === 'object' && !Array.isArray(item))));
  for (const [key, value] of scalarEntries) lines.push(`${quoteKey(key)} = ${formatValue(value)}`);
  const writeObject = (path: string[], object: { [key: string]: TomlValue }, arrayTable = false): void => {
    lines.push('', `${arrayTable ? '[[' : '['}${path.map(quoteKey).join('.')}${arrayTable ? ']]' : ']'}`);
    for (const [key, value] of Object.entries(object)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) continue;
      if (Array.isArray(value) && value.some((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) continue;
      lines.push(`${quoteKey(key)} = ${formatValue(value)}`);
    }
    for (const [key, value] of Object.entries(object)) {
      if (Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
        for (const item of value) writeObject([...path, key], item as { [key: string]: TomlValue }, true);
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        writeObject([...path, key], value);
      }
    }
  };
  for (const [key, value] of Object.entries(document)) {
    if (Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
      for (const item of value) writeObject([key], item as { [key: string]: TomlValue }, true);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) writeObject([key], value);
  }
  return `${lines.join('\n').replace(/^\n/u, '')}\n`;
}
