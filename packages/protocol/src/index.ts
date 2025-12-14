// Main exports
export {
  EnvelopeBuilder,
  defaultJSONEnvelopeBuilder,
  defaultBinaryEnvelopeBuilder,
  EnvelopeCodec,
  ProtoJSONCodec,
  ProtoBinaryCodec,
} from "./EnvelopeBuilder.js";
export type {
  EnvelopeOptions,
  SimpleEnvelopeOptions,
  UnpackedEnvelope,
} from "./EnvelopeBuilder.js";

// Helper functions
export {
  createHelloEnvelope,
  createRoomJoinEnvelope,
  createGameEventEnvelope,
  createGameEventEnvelopeWithJson,
} from "./helpers.js";
export type {
  HelloOptions,
  RoomJoinOptions,
  GameEventOptions,
} from "./helpers.js";

export * from "@buf/dialingames_partykit.bufbuild_es/v1/connection_pb";
export * from "@buf/dialingames_partykit.bufbuild_es/v1/room_pb";
export * from "@buf/dialingames_partykit.bufbuild_es/v1/game_pb";
export * from "@buf/dialingames_partykit.bufbuild_es/v1/state_pb";
export * from "@buf/dialingames_partykit.bufbuild_es/v1/envelope_pb";
export * from "@buf/dialingames_partykit.bufbuild_es/v1/presence_pb";
export * from "@buf/dialingames_partykit.bufbuild_es/v1/error_pb";
export * from "@buf/dialingames_partykit.bufbuild_es/v1/ping_pb";
