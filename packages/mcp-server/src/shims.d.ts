declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};

declare module '@modelcontextprotocol/sdk/server/mcp.js' {
  export class McpServer {
    constructor(metadata: { name: string; version: string });
    tool(name: string, description: string, inputSchema: unknown, handler: (input: unknown) => Promise<unknown> | unknown): void;
    connect(transport: unknown): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export class StdioServerTransport {}
}

declare module 'zod' {
  export const z: {
    object(shape: Record<string, unknown>): unknown;
    string(): { optional(): unknown; default(value: string): unknown };
    number(): { optional(): unknown; default(value: number): unknown };
    boolean(): { optional(): unknown; default(value: boolean): unknown };
    array(schema: unknown): unknown;
    record(schema: unknown): unknown;
    unknown(): unknown;
  };
}
