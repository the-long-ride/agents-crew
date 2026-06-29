declare namespace NodeJS {
  interface ProcessEnv { [key: string]: string | undefined }
  interface ErrnoException extends Error { code?: string }
}
declare const process: {
  pid: number;
  platform: string;
  arch: string;
  argv: string[];
  execPath: string;
  exitCode?: number;
  version: string;
  env: NodeJS.ProcessEnv;
  cwd(): string;
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
  once(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
  kill(pid: number, signal?: number | string): boolean;
};
declare class Buffer {
  static from(value: string | Buffer): Buffer;
  static isBuffer(value: unknown): value is Buffer;
  static concat(values: Buffer[]): Buffer;
  readonly length: number;
  toString(encoding?: string): string;
}
declare module 'node:crypto' {
  export function randomUUID(): string;
  export function createHash(name: string): { update(value: string | Buffer): any; digest(encoding: string): string };
}
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function createReadStream(path: string): { pipe(destination: unknown): unknown };
}
declare module 'node:fs/promises' {
  export function access(path: string | URL): Promise<void>;
  export function cp(source: string | URL, destination: string | URL, options?: unknown): Promise<void>;
  export function mkdir(path: string | URL, options?: unknown): Promise<void>;
  export function lstat(path: string | URL): Promise<{ isSymbolicLink(): boolean; isFile(): boolean; mode: number; size: number }>;
  export function readlink(path: string | URL): Promise<string>;
  export function open(path: string | URL, flags: string): Promise<{ write(value: string): Promise<unknown>; close(): Promise<void> }>;
  export function readFile(path: string | URL): Promise<Buffer>;
  export function readFile(path: string | URL, encoding: string): Promise<string>;
  export function readdir(path: string | URL): Promise<string[]>;
  export function readdir(path: string | URL, options: { withFileTypes: true }): Promise<{ name: string; isDirectory(): boolean }[]>;
  export function rename(source: string | URL, destination: string | URL): Promise<void>;
  export function rm(path: string | URL, options?: unknown): Promise<void>;
  export function stat(path: string | URL): Promise<{ mtimeMs: number }>;
  export function writeFile(path: string | URL, data: string | Buffer, encoding?: string): Promise<void>;
}
declare module 'node:path' {
  export const sep: string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...parts: string[]): string;
  export function normalize(path: string): string;
  export function relative(from: string, to: string): string;
  export function resolve(...parts: string[]): string;
}
declare module 'node:child_process' {
  export function execFile(command: string, args: string[], options: unknown, callback?: (...args: any[]) => void): any;
  export function spawn(command: string, args: string[], options: unknown): any;
}
declare module 'node:util' {
  export function promisify(fn: any): any;
}
declare module 'node:http' {
  export interface Server {
    once(event: string, listener: (...args: any[]) => void): this;
    listen(port: number, host: string, callback: () => void): this;
    address(): string | { port: number } | null;
    close(callback?: () => void): this;
  }
  export interface IncomingMessage { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; [Symbol.asyncIterator](): AsyncIterator<unknown> }
  export interface ServerResponse { writeHead(status: number, headers?: Record<string, string>): void; end(value?: string): void }
  export function createServer(listener: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): Server;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
