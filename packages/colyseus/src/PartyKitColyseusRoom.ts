import { Room, Client } from "colyseus";
import {
  create,
  type DescMessage,
  type MessageShape,
  type JsonValue,
} from "@bufbuild/protobuf";

import { PresenceTracker } from "./PresenceTracker.js";
import { generateRoomCode, ErrorCodes } from "./utils.js";

import {
  defaultJSONEnvelopeBuilder,
  type Hello,
  HelloOkSchema,
  HelloSchema,
  RoomInfoSchema,
  type RoomJoin,
  RoomJoinedSchema,
  RoomJoinSchema,
  RoomVisibility,
  type Envelope,
  type GameEvent,
  GameEventSchema,
  PresenceEventSchema,
  PresenceKind,
  SelfSchema,
  ErrorSchema,
  PingSchema,
  PongSchema,
  StateRequestSchema,
  StateUpdateKind,
  StateUpdateSchema,
  EnvelopeOptions,
  FeatureFlags,
  RoomInfo,
  FeatureFlagsSchema,
  ClientContext,
  HelloErrorSchema,
} from "@dialingames/partykit-protocol";
import { PartyKitAuthResult } from "./types.js";

export type CreateOptions = {
  roomCode?: string;
  roomType?: string;
  visibility?: RoomVisibility;
  maxClients?: number;
  features?: FeatureFlags;
};

export abstract class PartyKitColyseusRoom extends Room {
  protected readonly envelopeBuilder = defaultJSONEnvelopeBuilder;
  protected readonly presenceTracker = new PresenceTracker();

  protected partyRoomInfo: RoomInfo = create(RoomInfoSchema);

  /** Feature flags for protocol capabilities */
  protected features: FeatureFlags = create(FeatureFlagsSchema, {
    roomCodes: true,
    reconnect: false,
    statePatches: false,
    binary: false,
  });

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
    if (!roomCode) {
      throw new Error(
        "Generated room codes are disabled and no room code was provided."
      );
    }

    // Handle Infinity maxClients (use 0 to represent unlimited)
    const maxClientsValue = options.maxClients ?? this.maxClients;
    const maxClients = Number.isFinite(maxClientsValue) ? maxClientsValue : 0;

    this.partyRoomInfo = create(RoomInfoSchema, {
      id: roomCode ?? this.roomId,
      code: roomCode,
      type: options.roomType ?? "partykit",
      visibility: options.visibility ?? RoomVisibility.PRIVATE,
      maxClients,
    });

    this.roomId = this.partyRoomInfo.code ?? this.partyRoomInfo.id;

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
    ctx: ClientContext,
    join: RoomJoin
  ): Promise<void>;

  /**
   * Called for each incoming game event.
   * Must enforce authorization (capabilities/role) server-side.
   */
  protected abstract onPartyKitGameEvent(
    client: Client,
    ctx: ClientContext,
    ev: GameEvent
  ): Promise<void>;

  /**
   * Return a full state snapshot payload (JSON-friendly), packed into StateUpdate.state.
   * If you want patches, you can emit kind="patch" later.
   */
  protected abstract getStateSnapshot(ctx: ClientContext): Promise<unknown>;

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
    const unpacked = this.envelopeBuilder.decodeAndUnpack(
      payload as JsonValue,
      HelloSchema
    );
    if (!unpacked) {
      return;
    }
    const { envelope: env, data: hello } = unpacked;
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
      const error = create(HelloErrorSchema, {
        code: auth.code,
        message: auth.message,
        retryable: auth.retryable ?? false,
        details: auth.details,
      });
      this.sendEnvelope(client, "partykit/hello/error", error, {
        replyTo: env.id || "",
      });
      return;
    }

    this.presenceTracker.set(client.sessionId, auth.context);

    const ok = create(HelloOkSchema, {
      serverTime: BigInt(Date.now()),
      server: { name: "partykit-colyseus", version: "0.1.0" },
      features: this.features,
      clientContext: auth.context,
    });

    this.sendEnvelope(client, "partykit/hello/ok", ok, {
      replyTo: env.id || "",
    });
  }

  private async handleRoomJoin(client: Client, payload: unknown) {
    const unpacked = this.envelopeBuilder.decodeAndUnpack(
      payload as JsonValue,
      RoomJoinSchema
    );
    if (!unpacked) {
      return;
    }
    const { envelope: env, data: join } = unpacked;
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
        maxClients: this.partyRoomInfo.maxClients,
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
    const unpacked = this.envelopeBuilder.decodeAndUnpack(
      payload as JsonValue,
      StateRequestSchema
    );
    if (!unpacked) {
      return;
    }
    const { envelope: env, data: _req } = unpacked;
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
    const unpacked = this.envelopeBuilder.decodeAndUnpack(
      payload as JsonValue,
      PingSchema
    );
    if (!unpacked) {
      return;
    }
    const { envelope: env, data: ping } = unpacked;
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
    const unpacked = this.envelopeBuilder.decodeAndUnpack(
      payload as JsonValue,
      GameEventSchema
    );
    if (!unpacked) {
      return;
    }
    const { envelope: env, data: ev } = unpacked;
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
    opts?: Partial<EnvelopeOptions<T>>
  ) {
    const envelope = this.envelopeBuilder.encode({
      type,
      data: payload,
      to: opts?.to ?? client.sessionId,
      room: this.partyRoomInfo.id,
      from: opts?.from ?? "server",
      replyTo: opts?.replyTo,
    });

    client.send(type, envelope);
  }

  protected broadcastEnvelope<T extends DescMessage>(
    type: string,
    payload: MessageShape<T>,
    opts?: Partial<EnvelopeOptions<T>> & { except?: Client }
  ) {
    const envelope = this.envelopeBuilder.encode({
      type,
      data: payload,
      to: opts?.to ?? "broadcast",
      room: this.partyRoomInfo.id,
      from: opts?.from ?? "server",
    });

    if (opts?.except) {
      for (const c of this.clients) {
        if (c.sessionId === opts.except.sessionId) continue;
        c.send(type, envelope);
      }
    } else {
      this.broadcast(type, envelope);
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
    ctx: ClientContext,
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
}
