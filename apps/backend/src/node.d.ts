declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
  cwd(): string;
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): void;
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
    end(body?: string | Uint8Array): void;
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
  export function fileURLToPath(url: string | URL): string;

  export class URL {
    constructor(input: string, base?: string);
    host: string;
    hostname: string;
    pathname: string;
    search: string;
    searchParams: URLSearchParams;
    toString(): string;
  }
}

declare class URLSearchParams {
  constructor(init?: Record<string, string>);
  entries(): IterableIterator<[string, string]>;
  set(name: string, value: string): void;
  toString(): string;
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


declare module 'node:dgram' {
  export function createSocket(type: 'udp4' | 'udp6'): {
    once(event: 'error', listener: (error: Error) => void): void;
    once(event: 'message', listener: (message: Uint8Array) => void): void;
    send(message: Uint8Array, port: number, address: string, callback: (error?: Error) => void): void;
    close(): void;
  };
}

declare module 'node:dns' {
  const dns: {
    setDefaultResultOrder(order: 'ipv4first' | 'verbatim' | 'ipv6first'): void;
  };
  export default dns;
}

declare module 'node:dns/promises' {
  export class Resolver {
    constructor(options?: { timeout?: number; tries?: number });
    setServers(servers: string[]): void;
    resolve4(hostname: string): Promise<string[]>;
    resolve6(hostname: string): Promise<string[]>;
    resolveCname(hostname: string): Promise<string[]>;
    resolveNs(hostname: string): Promise<string[]>;
  }

  export function resolve4(hostname: string): Promise<string[]>;
  export function resolve6(hostname: string): Promise<string[]>;
  export function resolveTxt(hostname: string): Promise<string[][]>;
}


declare const Buffer: {
  from(input: string | Uint8Array, encoding?: 'utf8' | 'base64' | 'base64url' | 'hex'): Uint8Array & { toString(encoding?: 'utf8' | 'base64' | 'base64url' | 'hex'): string };
};

declare module 'node:crypto' {
  export function randomBytes(size: number): Uint8Array & { toString(encoding?: 'base64' | 'base64url' | 'hex'): string };
  export function scryptSync(password: string, salt: string, keylen: number, options?: { N?: number; r?: number; p?: number; maxmem?: number }): Uint8Array;
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  export function createHash(algorithm: 'sha256'): {
    update(data: string | Uint8Array): { digest(encoding: 'hex' | 'base64url'): string };
    digest(encoding: 'hex' | 'base64url'): string;
  };
  export function createHmac(algorithm: 'sha256', key: string | Uint8Array): {
    update(data: string): { digest(): Uint8Array; digest(encoding: 'hex'): string };
    digest(): Uint8Array;
    digest(encoding: 'hex'): string;
  };
  export function createCipheriv(algorithm: 'aes-256-gcm', key: Uint8Array, iv: Uint8Array): {
    update(data: string, inputEncoding: 'utf8'): Uint8Array;
    final(): Uint8Array;
    getAuthTag(): Uint8Array & { toString(encoding: 'base64'): string };
  };
  export function createDecipheriv(algorithm: 'aes-256-gcm', key: Uint8Array, iv: Uint8Array): {
    setAuthTag(tag: Uint8Array): void;
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
  };
}


declare module 'pg' {
  export class Pool {
    constructor(options: { connectionString: string });
    query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
    end(): Promise<void>;
  }

  const pg: { Pool: typeof Pool };
  export default pg;
}
