import { create, type JsonValue } from "@bufbuild/protobuf";
import {
  HelloSchema,
  ClientInfoSchema,
  ResumeInfoSchema,
  type ClientKind,
} from "@buf/dialingames_partykit.bufbuild_es/v1/connection_pb";
import { RoomJoinSchema } from "@buf/dialingames_partykit.bufbuild_es/v1/room_pb";
import { GameEventSchema } from "@buf/dialingames_partykit.bufbuild_es/v1/game_pb";
import {
  defaultJSONEnvelopeBuilder,
  EnvelopeBuilder,
} from "./EnvelopeBuilder.js";

/**
 * Options for creating a hello message.
 */
export interface HelloOptions {
  clientKind: ClientKind;
  clientName: string;
  engine?: string;
  engineVersion?: string;
  sdk?: string;
  sdkVersion?: string;
  room?: string;
  from?: string;
  reconnectToken?: string;
  resumeRoom?: string;
}

/**
 * Create a hello message envelope.
 */
export function createHelloEnvelope<E extends any>(
  options: HelloOptions,
  builder: EnvelopeBuilder<E>
): E {
  const hello = create(HelloSchema, {
    client: create(ClientInfoSchema, {
      kind: options.clientKind,
      name: options.clientName,
      engine: options.engine ?? "Unknown",
      engineVersion: options.engineVersion ?? "0.0.0",
      sdk: options.sdk ?? "partykit-protocol",
      sdkVersion: options.sdkVersion ?? "0.1.0",
    }),
    resume: options.reconnectToken || options.resumeRoom
      ? create(ResumeInfoSchema, {
          room: options.resumeRoom,
          reconnectToken: options.reconnectToken,
        })
      : undefined,
  });

  return builder.encode({
    type: "partykit/hello",
    data: hello,
    dataSchema: HelloSchema,
    to: "server",
    room: options.room,
    from: options.from,
  });
}

/**
 * Options for creating a room join message.
 */
export interface RoomJoinOptions {
  room: string;
  from?: string;
}

/**
 * Create a room join message envelope.
 */
export function createRoomJoinEnvelope<E extends any>(
  options: RoomJoinOptions,
  builder: EnvelopeBuilder<E>
): E {
  const join = create(RoomJoinSchema, {});

  return builder.encode({
    type: "partykit/room/join",
    data: join,
    dataSchema: RoomJoinSchema,
    to: "server",
    room: options.room,
    from: options.from,
  });
}

/**
 * Options for creating a game event message.
 */
export interface GameEventOptions {
  eventName: string;
  payload?: Uint8Array;
  room: string;
  from?: string;
}

/**
 * Create a game event message envelope.
 */
export function createGameEventEnvelope<E extends any>(
  options: GameEventOptions,
  builder: EnvelopeBuilder<E>
): E {
  const gameEvent = create(GameEventSchema, {
    name: options.eventName,
    payload: options.payload ?? new Uint8Array(),
  });

  return builder.encode({
    type: "game/event",
    data: gameEvent,
    dataSchema: GameEventSchema,
    to: "server",
    room: options.room,
    from: options.from,
  });
}

/**
 * Create a game event with JSON payload.
 */
export function createGameEventEnvelopeWithJson(
  eventName: string,
  payload: unknown,
  room: string,
  from?: string,
  builder: EnvelopeBuilder<JsonValue> = defaultJSONEnvelopeBuilder
): JsonValue {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

  return createGameEventEnvelope(
    {
      eventName,
      payload: payloadBytes,
      room,
      from,
    },
    builder
  );
}
