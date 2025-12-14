import { Room, Client } from "colyseus";
import { anyPack, anyUnpack } from "@bufbuild/protobuf/wkt";

import { EnvelopeCodec } from "./codec/EnvelopeCodec.js";
import { PresenceTracker } from "./PresenceTracker.js";
import type {
  PartyKitAuthResult,
  PartyKitClientContext,
  PartyKitRoomInfo,
} from "./types.js";
import { generateMessageId, generateRoomCode, ErrorCodes } from "./utils.js";

import {
  Hello,
  HelloOkSchema,
  HelloSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/connection_pb";
import {
  RoomInfoSchema,
  RoomJoin,
  RoomJoinedSchema,
  RoomJoinSchema,
  RoomVisibility,
} from "@buf/dialingames_partykit.bufbuild_es/v1/room_pb";
import {
  Envelope,
  EnvelopeSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/envelope_pb";
import {
  GameEvent,
  GameEventSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/game_pb";
import {
  PresenceEventSchema,
  PresenceKind,
  SelfSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/presence_pb.js";
import { ErrorSchema } from "@buf/dialingames_partykit.bufbuild_es/v1/error_pb.js";
import {
  PingSchema,
  PongSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/ping_pb.js";
import {
  StateRequestSchema,
  StateUpdateKind,
  StateUpdateSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/state_pb.js";
import {
  create,
  createRegistry,
  DescMessage,
  MessageShape,
} from "@bufbuild/protobuf";

type CreateOptions = {
  roomCode?: string;
  roomType?: string;
  visibility?: RoomVisibility;
  maxClients?: number;
  features?: {
    roomCodes?: boolean;
    reconnect?: boolean;
    statePatches?: boolean;
    binary?: boolean;
  };
};

export abstract class PartyKitColyseusRoom extends Room {
  private readonly registry = createRegistry(
    HelloOkSchema,
    HelloSchema,
    RoomInfoSchema,
    RoomJoinedSchema,
    RoomJoinSchema,
    GameEventSchema,
    PresenceEventSchema,
    SelfSchema,
    ErrorSchema,
    PingSchema,
    PongSchema,
    StateRequestSchema,
    StateUpdateSchema,
    EnvelopeSchema
  );
  protected readonly envCodec = new EnvelopeCodec(this.registry);
  protected readonly presenceTracker = new PresenceTracker();

  protected partyRoomInfo: PartyKitRoomInfo = {
    id: "",
    type: "partykit",
  };

  /** Feature flags for protocol capabilities */
  protected features = {
    roomCodes: true,
    reconnect: false,
    statePatches: false,
    binary: false,
  };

  /** Increment when emitting state snapshots/patches. */
  protected tick = 0;

  // -----------------------
  // Colyseus lifecycle
  // -----------------------

  override onCreate(options: CreateOptions) {
    // Merge feature flags
    if (options.features) {
      this.features = { ...this.features, ...options.features };
    }

    // Auto-generate room code if feature is enabled and not provided
    const roomCode =
      options.roomCode ??
      (this.features.roomCodes ? generateRoomCode() : undefined);

    this.partyRoomInfo = {
      id: this.roomId,
      code: roomCode,
      type: options.roomType ?? "partykit",
      visibility: options.visibility ?? RoomVisibility.PRIVATE,
      maxClients: options.maxClients ?? this.maxClients,
    };

    // Register PartyKit message handlers (by message type string)
    this.onMessage("partykit/hello", (client, payload) =>
      this.handleHello(client, payload)
    );
    this.onMessage("partykit/room/join", (client, payload) =>
      this.handleRoomJoin(client, payload)
    );
    this.onMessage("partykit/state/request", (client, payload) =>
      this.handleStateRequest(client, payload)
    );
    this.onMessage("partykit/ping", (client, payload) =>
      this.handlePing(client, payload)
    );
    this.onMessage("game/event", (client, payload) =>
      this.handleGameEvent(client, payload)
    );

    // Optional: allow clients to send raw Envelope JSON where `t` is used as the colyseus message type.
    // We already route by type, so each handler reconstructs Envelope anyway.
  }

  override async onJoin(client: Client, options: any) {
    // Colyseus join succeeded; PartyKit still requires hello + room/join.
    // We do not assign roles/caps here; that happens on hello/join.
    await this.onColyseusJoin(client, options);
  }

  override async onLeave(client: Client, consented: boolean) {
    const ev = this.presenceTracker.onLeave(client);
    if (ev)
      this.broadcastEnvelope("partykit/presence", ev, {
        from: "server",
        to: "broadcast",
      });

    await this.onColyseusLeave(client, consented);
  }

  // -----------------------
  // Abstract hooks (you implement per game)
  // -----------------------

  /**
   * Authenticate and build the PartyKit client context from Hello.
   * Must NOT trust client.kind/role hints for authorization.
   */
  protected abstract authorizeHello(
    client: Client,
    hello: Hello
  ): Promise<PartyKitAuthResult>;

  /**
   * Called once a client is fully PartyKit-joined (after hello + room/join).
   */
  protected abstract onPartyKitJoin(
    client: Client,
    ctx: PartyKitClientContext,
    join: RoomJoin
  ): Promise<void>;

  /**
   * Called for each incoming game event.
   * Must enforce authorization (capabilities/role) server-side.
   */
  protected abstract onPartyKitGameEvent(
    client: Client,
    ctx: PartyKitClientContext,
    ev: GameEvent
  ): Promise<void>;

  /**
   * Return a full state snapshot payload (JSON-friendly), packed into StateUpdate.state.
   * If you want patches, you can emit kind="patch" later.
   */
  protected abstract getStateSnapshot(
    ctx: PartyKitClientContext
  ): Promise<unknown>;

  /**
   * Optional Colyseus lifecycle hooks.
   */
  protected async onColyseusJoin(
    _client: Client,
    _options: any
  ): Promise<void> {}
  protected async onColyseusLeave(
    _client: Client,
    _consented: boolean
  ): Promise<void> {}

  // -----------------------
  // Handler implementations
  // -----------------------

  private async handleHello(client: Client, payload: unknown) {
    const env = this.envCodec.decodeEnvelope(payload);
    const hello = this.unpack(env, HelloSchema);
    if (!hello) {
      this.sendError(
        client,
        env,
        ErrorCodes.BAD_REQUEST,
        "Invalid hello message.",
        false
      );
      return;
    }

    const auth = await this.authorizeHello(client, hello);
    if (!auth.ok) {
      this.sendError(
        client,
        env,
        auth.code,
        auth.message,
        auth.retryable ?? false,
        auth.details
      );
      return;
    }

    this.presenceTracker.set(client.sessionId, auth.context);

    const ok = create(HelloOkSchema, {
      serverTime: BigInt(Date.now()),
      server: { name: "partykit-colyseus", version: "0.1.0" },
      features: this.features,
    });

    this.sendEnvelope(client, "partykit/hello/ok", ok, {
      replyTo: env.id || "",
    });
  }

  private async handleRoomJoin(client: Client, payload: unknown) {
    const env = this.envCodec.decodeEnvelope(payload);
    const join = this.unpack(env, RoomJoinSchema);
    if (!join) {
      this.sendError(
        client,
        env,
        ErrorCodes.BAD_REQUEST,
        "Invalid room join message.",
        false
      );
      return;
    }

    const ctx = this.presenceTracker.get(client.sessionId);
    if (!ctx) {
      this.sendError(
        client,
        env,
        ErrorCodes.UNAUTHORIZED,
        "Must send partykit/hello before joining.",
        false
      );
      return;
    }

    // Reply with RoomJoined
    const joined = create(RoomJoinedSchema, {
      room: create(RoomInfoSchema, {
        id: this.partyRoomInfo.id,
        code: this.partyRoomInfo.code ?? "",
        type: this.partyRoomInfo.type,
        visibility: this.partyRoomInfo.visibility ?? RoomVisibility.PRIVATE,
        maxClients: this.partyRoomInfo.maxClients ?? 0,
      }),
    });
    this.sendEnvelope(client, "partykit/room/joined", joined, {
      replyTo: env.id || "",
    });

    // Send Self (authoritative role/caps)
    const self = create(SelfSchema, {
      clientId: ctx.clientId,
      role: ctx.role,
      capabilities: ctx.capabilities,
      reconnectToken: ctx.reconnectToken ?? "",
      groups: ctx.groups,
    });
    this.sendEnvelope(client, "partykit/self", self);

    // Presence: send snapshot to the joining client (optional but recommended)
    // If you have a PresenceSnapshot proto, use it. Otherwise, burst join events:
    for (const existing of this.presenceTracker.list()) {
      // emit join events for existing clients to the new client (excluding self)
      if (existing.clientId === ctx.clientId) continue;
      const ev = create(PresenceEventSchema, {
        kind: PresenceKind.JOIN,
        client: {
          clientId: existing.clientId,
          displayName: existing.displayName ?? "",
          role: existing.role,
          metadata: existing.metadata,
        },
      });
      this.sendEnvelope(client, "partykit/presence", ev);
    }

    // Broadcast that this client joined
    const joinEv = this.presenceTracker.onJoin(client, ctx);
    this.broadcastEnvelope("partykit/presence", joinEv, {
      from: "server",
      to: "broadcast",
      except: client,
    });

    // Send initial state snapshot to the client
    await this.sendStateSnapshotTo(client, ctx);

    // Game hook
    await this.onPartyKitJoin(client, ctx, join);
  }

  private async handleStateRequest(client: Client, payload: unknown) {
    const env = this.envCodec.decodeEnvelope(payload);
    const _req = this.unpack(env, StateRequestSchema);
    if (!_req) {
      this.sendError(
        client,
        env,
        ErrorCodes.BAD_REQUEST,
        "Invalid state request message.",
        false
      );
      return;
    }

    const ctx = this.presenceTracker.get(client.sessionId);
    if (!ctx) {
      this.sendError(
        client,
        env,
        ErrorCodes.UNAUTHORIZED,
        "Must be joined to request state.",
        false
      );
      return;
    }

    await this.sendStateSnapshotTo(client, ctx, env.id || "");
  }

  private async handlePing(client: Client, payload: unknown) {
    const env = this.envCodec.decodeEnvelope(payload);
    const ping = this.unpack(env, PingSchema);
    if (!ping) {
      this.sendError(
        client,
        env,
        ErrorCodes.BAD_REQUEST,
        "Invalid ping message.",
        false
      );
      return;
    }

    const pong = create(PongSchema, { serverTime: BigInt(Date.now()) });
    this.sendEnvelope(client, "partykit/pong", pong, { replyTo: env.id || "" });
  }

  private async handleGameEvent(client: Client, payload: unknown) {
    const env = this.envCodec.decodeEnvelope(payload);
    const ev = this.unpack(env, GameEventSchema);
    if (!ev) {
      this.sendError(
        client,
        env,
        ErrorCodes.BAD_REQUEST,
        "Invalid game event message.",
        false
      );
      return;
    }

    const ctx = this.presenceTracker.get(client.sessionId);
    if (!ctx) {
      this.sendError(
        client,
        env,
        ErrorCodes.UNAUTHORIZED,
        "Must be joined to send game events.",
        false
      );
      return;
    }

    try {
      await this.onPartyKitGameEvent(client, ctx, ev);
    } catch (e: any) {
      this.sendError(
        client,
        env,
        ErrorCodes.INTERNAL,
        e?.message ?? "Unhandled server error.",
        true
      );
    }
  }

  // -----------------------
  // Envelope send helpers
  // -----------------------

  protected sendEnvelope<T extends DescMessage>(
    client: Client,
    type: string,
    payload: MessageShape<T>,
    opts?: { replyTo?: string; to?: string; from?: string }
  ) {
    const schema = this.registry.getMessage(payload.$typeName);
    if (!schema) {
      throw new Error(`Unknown message type: ${payload.$typeName}`);
    }

    const env = create(EnvelopeSchema, {
      v: 1,
      t: type,
      id: generateMessageId(),
      replyTo: opts?.replyTo ?? "",
      ts: BigInt(Date.now()),
      room: this.partyRoomInfo.id,
      from: opts?.from ?? "server",
      to: opts?.to ?? client.sessionId,
      data: anyPack(schema, payload), // requires Envelope.data = google.protobuf.Any
    });

    client.send(type, this.envCodec.encodeEnvelope(env));
  }

  protected broadcastEnvelope<T extends DescMessage>(
    type: string,
    payload: MessageShape<T>,
    opts?: { to?: string; from?: string; except?: Client }
  ) {
    const schema = this.registry.getMessage(payload.$typeName);
    if (!schema) {
      throw new Error(`Unknown message type: ${payload.$typeName}`);
    }

    const env = create(EnvelopeSchema, {
      v: 1,
      t: type,
      id: generateMessageId(),
      replyTo: "",
      ts: BigInt(Date.now()),
      room: this.partyRoomInfo.id,
      from: opts?.from ?? "server",
      to: opts?.to ?? "broadcast",
      data: anyPack(schema, payload),
    });

    if (opts?.except) {
      for (const c of this.clients) {
        if (c.sessionId === opts.except.sessionId) continue;
        c.send(type, this.envCodec.encodeEnvelope(env));
      }
    } else {
      this.broadcast(type, this.envCodec.encodeEnvelope(env));
    }
  }

  protected sendError(
    client: Client,
    requestEnv: Envelope,
    code: string,
    message: string,
    retryable: boolean,
    details?: unknown
  ) {
    const err = create(ErrorSchema, {
      code,
      message,
      retryable,
      // details could be JSON-encoded into a string or Any later; keep simple for v0.1
      details: new Uint8Array(), // if your proto uses bytes; otherwise omit/adjust
    });

    this.sendEnvelope(client, "partykit/error", err, {
      replyTo: requestEnv.id || "",
    });
  }

  // -----------------------
  // State snapshot helper
  // -----------------------

  private async sendStateSnapshotTo(
    client: Client,
    ctx: PartyKitClientContext,
    replyTo?: string
  ) {
    const snapshot = await this.getStateSnapshot(ctx);
    this.tick++;

    // v0.1: pack JSON snapshot into state bytes? Better: make StateUpdate.state be Any or Struct.
    // If your proto uses bytes, you can JSON.stringify(snapshot) here.
    const encoded = new TextEncoder().encode(JSON.stringify(snapshot));

    const state = create(StateUpdateSchema, {
      kind: StateUpdateKind.SNAPSHOT,
      tick: BigInt(this.tick),
      state: encoded,
    });

    this.sendEnvelope(client, "partykit/state", state, { replyTo });
  }

  // -----------------------
  // Unpack helper
  // -----------------------

  private unpack<T extends DescMessage>(
    env: Envelope,
    schema: T
  ): MessageShape<T> | undefined {
    if (!env.data) return undefined;
    return anyUnpack(env.data, schema);
  }
}
