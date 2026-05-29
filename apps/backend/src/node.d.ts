declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
  cwd(): string;
};

declare module 'node:process' {
  const process: {
    env: Record<string, string | undefined>;
    exitCode?: number;
    cwd(): string;
    on(event: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  };
  export default process;
}

declare module 'node:http' {
  import type { URL } from 'node:url';

  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: 'data', listener: (chunk: Uint8Array) => void): void;
    on(event: 'end', listener: () => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
  }

  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string | number): void;
    end(body?: string): void;
  }

  export interface Server {
    listen(port: number, listener?: () => void): void;
    close(callback?: () => void): void;
  }

  export function createServer(listener: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): Server;
}

declare module 'node:fs' {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
}

declare module 'node:url' {
  export class URL {
    constructor(input: string, base?: string);
    pathname: string;
    search: string;
  }
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...values: unknown[]): unknown;
      run(...values: unknown[]): unknown;
    };
    close(): void;
  }
}


declare module 'node:child_process' {
  export function execFileSync(command: string, args?: string[], options?: { input?: string; encoding?: 'utf8'; stdio?: unknown }): string;
}

declare module 'node:dns/promises' {
  export function resolveTxt(hostname: string): Promise<string[][]>;
}
