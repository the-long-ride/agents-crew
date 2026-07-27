declare const process: {
  platform: string;
  arch: string;
  pid: number;
  argv: string[];
  execPath: string;
  exitCode?: number;
  env: Record<string, string | undefined>;
  cwd(): string;
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
};

declare module 'node:child_process' {
  export function spawn(command: string, args: string[], options: unknown): any;
}

declare module 'node:crypto' {
  export function createHash(algorithm: string): any;
}

declare module 'node:fs' {
  export function createReadStream(path: string): AsyncIterable<unknown>;
  export function createWriteStream(path: string, options?: unknown): any;
}

declare module 'node:fs/promises' {
  export function access(path: string): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function copyFile(source: string, destination: string): Promise<void>;
  export function lstat(path: string): Promise<{ isFile(): boolean }>;
  export function mkdir(path: string, options?: unknown): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function readFile(path: string | URL, encoding: string): Promise<string>;
  export function rename(source: string, destination: string): Promise<void>;
  export function rm(path: string, options?: unknown): Promise<void>;
  export function writeFile(path: string | URL, data: string, options?: unknown): Promise<void>;
}

declare module 'node:os' {
  export function homedir(): string;
  export function tmpdir(): string;
}

declare module 'node:path' {
  export const delimiter: string;
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}

declare module 'node:process' {
  export const stdin: any;
  export const stdout: { write(value: string): unknown };
}

declare module 'node:readline/promises' {
  export function createInterface(options: unknown): {
    question(message: string): Promise<string>;
    close(): void;
  };
}

declare module 'node:stream' {
  export const Readable: { fromWeb(stream: never): any };
}

declare module 'node:stream/promises' {
  export function pipeline(...streams: any[]): Promise<void>;
}

declare module 'node:url' {
  export function pathToFileURL(path: string): { href: string };
}
