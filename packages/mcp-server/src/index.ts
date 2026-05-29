#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface ToolInput {
  slug?: string;
  files?: unknown;
  ttlSeconds?: number;
  viewer?: string;
  spaMode?: boolean;
  anonymous?: boolean;
  claimToken?: string;
  versionId?: string;
  metadata?: Record<string, unknown>;
}

const apiBaseUrl = (process.env.DIVBAND_API_BASE_URL ?? 'https://api.divband.local').replace(/\/+$/, '');
const apiToken = process.env.DIVBAND_API_TOKEN;

const fileManifestSchema = z.object({
  path: z.string(),
  size: z.number(),
  contentType: z.string(),
  hash: z.string(),
});

const publishInputSchema = {
  files: z.array(fileManifestSchema),
  ttlSeconds: z.number().optional(),
  viewer: z.string().optional(),
  spaMode: z.boolean().optional(),
  anonymous: z.boolean().optional(),
};

const updateInputSchema = {
  slug: z.string(),
  files: z.array(fileManifestSchema),
  ttlSeconds: z.number().optional(),
  viewer: z.string().optional(),
  spaMode: z.boolean().optional(),
  claimToken: z.string().optional(),
};

const claimInputSchema = {
  slug: z.string(),
  claimToken: z.string(),
};

const slugInputSchema = {
  slug: z.string(),
  claimToken: z.string().optional(),
};

async function requestDivband(method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: 'application/json',
  };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (apiToken) {
    headers.authorization = `Bearer ${apiToken}`;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = responseBody && typeof responseBody === 'object' && 'error' in responseBody
      ? JSON.stringify(responseBody)
      : `divband API returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return responseBody;
}

function publishBody(input: ToolInput): Record<string, unknown> {
  return {
    files: input.files,
    ttlSeconds: input.ttlSeconds,
    viewer: input.viewer,
    spaMode: input.spaMode,
    anonymous: input.anonymous,
    claimToken: input.claimToken,
    ...input.metadata,
  };
}

const server = new McpServer({
  name: 'divband-agent-publishing',
  version: '0.1.0',
});

server.tool('publish_site', 'Create an instant static publish upload plan from a file manifest.', publishInputSchema, async (input) => {
  return requestDivband('POST', '/api/v1/publish', publishBody(input as ToolInput));
});

server.tool('update_site', 'Create a new upload plan for an existing divband static site.', updateInputSchema, async (input) => {
  const typed = input as ToolInput;
  return requestDivband('PUT', `/api/v1/publish/${encodeURIComponent(requiredSlug(typed))}`, publishBody(typed));
});

server.tool('claim_site', 'Claim an anonymous divband site into the authenticated account.', claimInputSchema, async (input) => {
  const typed = input as ToolInput;
  return requestDivband('POST', `/api/v1/publish/${encodeURIComponent(requiredSlug(typed))}/claim`, { claimToken: typed.claimToken });
});

server.tool('get_site', 'Get metadata for a divband static site by slug.', slugInputSchema, async (input) => {
  const typed = input as ToolInput;
  return requestDivband('GET', `/api/v1/publish/${encodeURIComponent(requiredSlug(typed))}`);
});

server.tool('list_sites', 'List divband static sites owned by the authenticated account.', {}, async () => {
  return requestDivband('GET', '/api/v1/publishes');
});

server.tool('delete_site', 'Delete a divband static site. Owned sites require DIVBAND_API_TOKEN; anonymous sites may include claimToken.', slugInputSchema, async (input) => {
  const typed = input as ToolInput;
  return requestDivband('DELETE', `/api/v1/publish/${encodeURIComponent(requiredSlug(typed))}`, typed.claimToken ? { claimToken: typed.claimToken } : undefined);
});

function requiredSlug(input: ToolInput): string {
  if (!input.slug) {
    throw new Error('slug is required.');
  }
  return input.slug;
}

await server.connect(new StdioServerTransport());
