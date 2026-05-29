import type { AuditEvent, JsonObject } from '../models.ts';
import type { BackendStore } from '../store.ts';
import { createId, nowIso } from '../utils.ts';

export class AuditLogService {
  constructor(private readonly store: BackendStore) {}

  record(actorId: string, action: string, metadata: JsonObject = {}, projectId?: string): AuditEvent {
    const event: AuditEvent = {
      id: createId('audit'),
      actorId,
      action,
      projectId,
      metadata,
      createdAt: nowIso(),
    };

    this.store.auditEvents.push(event);
    return event;
  }

  listForProject(projectId: string): AuditEvent[] {
    return this.store.auditEvents.filter((event) => event.projectId === projectId);
  }
}
