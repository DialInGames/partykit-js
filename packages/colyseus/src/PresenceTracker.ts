import type { Client } from "colyseus";
import {
  PresenceEvent,
  Client as PKClient,
  ClientSchema as PKClientSchema,
  PresenceEventSchema,
  PresenceKind,
  ClientContext,
} from "@dialingames/partykit-protocol";
import { create } from "@bufbuild/protobuf";

export class PresenceTracker {
  private readonly ctxBySessionId = new Map<string, ClientContext>();

  /** Set/replace context for a session id (e.g. after hello). */
  set(sessionId: string, ctx: ClientContext): void {
    this.ctxBySessionId.set(sessionId, ctx);
  }

  /** Remove context for a session id without emitting an event. */
  delete(sessionId: string): void {
    this.ctxBySessionId.delete(sessionId);
  }

  get(sessionId: string): ClientContext | undefined {
    return this.ctxBySessionId.get(sessionId);
  }

  list(): ClientContext[] {
    return [...this.ctxBySessionId.values()];
  }

  /** Create a join event and store context keyed by Colyseus session id. */
  onJoin(client: Client, ctx: ClientContext): PresenceEvent {
    this.set(client.sessionId, ctx);
    return create(PresenceEventSchema, {
      kind: PresenceKind.JOIN,
      client: this.toProtoClient(ctx),
    });
  }

  /** Create a leave event and remove context keyed by Colyseus session id. */
  onLeave(client: Client): PresenceEvent | null {
    const ctx = this.get(client.sessionId);
    if (!ctx) return null;

    this.delete(client.sessionId);
    return create(PresenceEventSchema, {
      kind: PresenceKind.LEAVE,
      client: this.toProtoClient(ctx),
    });
  }

  /** Snapshot of currently tracked clients as protocol Client messages. */
  snapshotProto(): PKClient[] {
    return this.list().map((c) => this.toProtoClient(c));
  }

  private toProtoClient(ctx: ClientContext): PKClient {
    return create(PKClientSchema, {
      clientId: ctx.clientId,
      displayName: ctx.displayName ?? "",
      role: ctx.role,
      metadata: ctx.metadata ?? {},
    });
  }
}
