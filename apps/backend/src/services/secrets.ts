import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import process from 'node:process';
import type { EnvironmentVariable, Project, ProjectEnvironmentSecret } from '../models.ts';
import type { BackendStore } from '../store.ts';
import { maskSecret, nowIso } from '../utils.ts';

const ALGORITHM = 'aes-256-gcm' as const;
const LOCAL_DEV_SECRET_KEY = 'divband-local-development-secret-key';

export class ProjectSecretService {
  private readonly key: Uint8Array;

  constructor(private readonly store: BackendStore, env: Record<string, string | undefined> = process.env) {
    const configuredKey = env.DIVBAND_SECRET_ENCRYPTION_KEY?.trim();
    this.key = deriveKey(configuredKey || LOCAL_DEV_SECRET_KEY);
  }

  list(project: Project, options: { reveal?: boolean } = {}): EnvironmentVariable[] {
    return this.projectSecrets(project.id).map((secret) => this.toEnvironmentVariable(secret, options.reveal === true));
  }

  require(project: Project, key: string): EnvironmentVariable {
    const normalizedKey = normalizeEnvironmentKey(key);
    const secret = this.store.projectEnvironmentSecrets.get(this.storeKey(project.id, normalizedKey));
    if (!secret) {
      throw new Error('Environment variable not found.');
    }
    return this.toEnvironmentVariable(secret, true);
  }

  upsert(project: Project, variables: unknown): EnvironmentVariable[] {
    if (!Array.isArray(variables)) {
      throw new Error('environmentVariables must be an array.');
    }

    for (const variable of variables) {
      if (!isVariableInput(variable)) {
        throw new Error('Each environment variable requires key and value strings.');
      }
      const key = normalizeEnvironmentKey(variable.key);
      if (!key) {
        throw new Error('Environment variable key is required.');
      }
      const existing = this.store.projectEnvironmentSecrets.get(this.storeKey(project.id, key));
      const timestamp = nowIso();
      const encrypted = this.encrypt(variable.value);
      const secret: ProjectEnvironmentSecret = {
        projectId: project.id,
        key,
        encryptedValue: encrypted.encryptedValue,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        algorithm: ALGORITHM,
        protected: Boolean(variable.protected),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      this.store.projectEnvironmentSecrets.set(this.storeKey(project.id, key), secret);
    }

    return this.list(project);
  }

  delete(project: Project, key: string): EnvironmentVariable[] {
    this.store.projectEnvironmentSecrets.delete(this.storeKey(project.id, normalizeEnvironmentKey(key)));
    return this.list(project);
  }

  protectedKeys(project: Project): string[] {
    return this.projectSecrets(project.id).filter((secret) => secret.protected).map((secret) => secret.key);
  }

  private projectSecrets(projectId: string): ProjectEnvironmentSecret[] {
    return [...this.store.projectEnvironmentSecrets.values()]
      .filter((secret) => secret.projectId === projectId)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  private toEnvironmentVariable(secret: ProjectEnvironmentSecret, reveal: boolean): EnvironmentVariable {
    const value = this.decrypt(secret);
    return {
      key: secret.key,
      value: reveal ? value : maskSecret(value),
      protected: secret.protected,
      updatedAt: secret.updatedAt,
    };
  }

  private encrypt(value: string): Pick<ProjectEnvironmentSecret, 'encryptedValue' | 'iv' | 'authTag'> {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = concatBytes(cipher.update(value, 'utf8'), cipher.final());
    return {
      encryptedValue: toBase64(encrypted),
      iv: toBase64(iv),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  private decrypt(secret: ProjectEnvironmentSecret): string {
    const decipher = createDecipheriv(ALGORITHM, this.key, fromBase64(secret.iv));
    decipher.setAuthTag(fromBase64(secret.authTag));
    return new TextDecoder().decode(concatBytes(decipher.update(fromBase64(secret.encryptedValue)), decipher.final()));
  }

  private storeKey(projectId: string, key: string): string {
    return `${projectId}:${key}`;
  }
}

function normalizeEnvironmentKey(key: string): string {
  return key.trim().toUpperCase();
}

function deriveKey(secret: string): Uint8Array {
  return fromHex(createHash('sha256').update(secret).digest('hex'));
}

function isVariableInput(value: unknown): value is { key: string; value: string; protected?: unknown } {
  return typeof value === 'object' && value !== null && typeof (value as { key?: unknown }).key === 'string' && typeof (value as { value?: unknown }).value === 'string';
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return Buffer.from(value, 'base64');
}

function fromHex(value: string): Uint8Array {
  return Buffer.from(value, 'hex');
}
