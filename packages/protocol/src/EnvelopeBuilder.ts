import {
  create,
  toJson,
  fromJson,
  createRegistry,
  type JsonValue,
  type Registry,
  type DescMessage,
  type MessageShape,
  fromBinary,
  toBinary,
} from "@bufbuild/protobuf";
import { anyPack, anyUnpack } from "@bufbuild/protobuf/wkt";
import {
  Envelope,
  EnvelopeSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/envelope_pb";
import {
  HelloSchema,
  HelloOkSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/connection_pb";
import {
  RoomJoinSchema,
  RoomJoinedSchema,
  RoomInfoSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/room_pb";
import { GameEventSchema } from "@buf/dialingames_partykit.bufbuild_es/v1/game_pb";
import {
  PresenceEventSchema,
  SelfSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/presence_pb";
import { ErrorSchema } from "@buf/dialingames_partykit.bufbuild_es/v1/error_pb";
import {
  PingSchema,
  PongSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/ping_pb";
import {
  StateRequestSchema,
  StateUpdateSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/state_pb";

/**
 * Default registry with all common PartyKit message schemas.
 */
const defaultRegistry = createRegistry(
  HelloSchema,
  HelloOkSchema,
  RoomJoinSchema,
  RoomJoinedSchema,
  RoomInfoSchema,
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

/**
 * Options for creating an envelope with explicit schema.
 */
export interface EnvelopeOptions<S extends DescMessage> {
  /** Message type (e.g., "partykit/hello", "game/event") */
  type: string;
  /** Message data (will be packed into Any) */
  data: MessageShape<S>;
  /** Data schema for packing */
  dataSchema: S;
  /** Recipient of the message (e.g., "server", client ID) */
  to: string;
  /** Room ID (required for most messages) */
  room?: string;
  /** Sender of the message (defaults to empty string) */
  from?: string;
  /** Message ID (auto-generated if not provided) */
  id?: string;
  /** Reply-to message ID */
  replyTo?: string;
  /** Timestamp (auto-generated if not provided) */
  ts?: bigint;
  /** Protocol version (defaults to 1) */
  version?: number;
}

/**
 * Simplified options for creating an envelope (schema auto-detected).
 */
export interface SimpleEnvelopeOptions {
  /** Message type (e.g., "partykit/hello", "game/event") */
  type: string;
  /** Message data with $typeName (schema will be auto-detected) */
  data: { $typeName: string; [key: string]: any };
  /** Recipient of the message (e.g., "server", client ID) */
  to: string;
  /** Room ID (required for most messages) */
  room?: string;
  /** Sender of the message (defaults to empty string) */
  from?: string;
  /** Message ID (auto-generated if not provided) */
  id?: string;
  /** Reply-to message ID */
  replyTo?: string;
  /** Timestamp (auto-generated if not provided) */
  ts?: bigint;
  /** Protocol version (defaults to 1) */
  version?: number;
}

/**
 * Result of unpacking an envelope.
 */
export interface UnpackedEnvelope<T> {
  /** The unpacked message data */
  data: T;
  /** The original envelope */
  envelope: Envelope;
}

/**
 * Codec for encoding and decoding PartyKit envelopes.
 */
export interface EnvelopeCodec<EncodedValue extends any> {
  /**
   * Encode an envelope into an encoded value.
   */
  encode(envelope: Envelope): EncodedValue;
  /**
   * Decode an encoded value into an envelope.
   */
  decode(encoded: EncodedValue): Envelope;
}

/**
 * Codec for encoding and decoding PartyKit envelopes to JSON.
 */
export class ProtoJSONCodec implements EnvelopeCodec<JsonValue> {
  private registry: Registry;

  constructor(additionalSchemas: DescMessage[] = []) {
    this.registry = createRegistry(
      ...Array.from(defaultRegistry),
      ...additionalSchemas
    );
  }

  encode(envelope: Envelope): JsonValue {
    return toJson(EnvelopeSchema, envelope, { registry: this.registry });
  }

  decode(encoded: JsonValue): Envelope {
    return fromJson(EnvelopeSchema, encoded, { registry: this.registry });
  }
}

/**
 * Codec for encoding and decoding PartyKit envelopes to binary.
 */
export class ProtoBinaryCodec implements EnvelopeCodec<Uint8Array> {
  encode(envelope: Envelope): Uint8Array {
    return toBinary(EnvelopeSchema, envelope);
  }

  decode(encoded: Uint8Array): Envelope {
    return fromBinary(EnvelopeSchema, encoded);
  }
}

/**
 * Builder for creating and encoding PartyKit envelopes.
 */
export class EnvelopeBuilder<EncodedValue extends any> {
  private registry: Registry;
  private codec: EnvelopeCodec<EncodedValue>;

  constructor(
    codec: EnvelopeCodec<EncodedValue>,
    additionalSchemas: DescMessage[] = []
  ) {
    // If additional schemas provided, create a new registry
    if (additionalSchemas.length > 0) {
      this.registry = createRegistry(
        ...Array.from(defaultRegistry),
        ...additionalSchemas
      );
    } else {
      this.registry = defaultRegistry;
    }
    this.codec = codec;
  }

  /**
   * Create and encode an envelope to JSON with explicit schema.
   */
  encode<S extends DescMessage>(options: EnvelopeOptions<S>): EncodedValue;

  /**
   * Create and encode an envelope to JSON with auto-detected schema.
   * The schema is looked up from the registry based on the data's $typeName.
   */
  encode(options: SimpleEnvelopeOptions): EncodedValue;

  encode(options: EnvelopeOptions<any> | SimpleEnvelopeOptions): EncodedValue {
    // If dataSchema is not provided, look it up from the registry
    let dataSchema: DescMessage;
    if ("dataSchema" in options && options.dataSchema) {
      dataSchema = options.dataSchema;
    } else {
      const typeName = options.data.$typeName;
      const schema = this.registry.getMessage(typeName);
      if (!schema) {
        throw new Error(
          `Unknown message type: ${typeName}. Make sure the schema is registered.`
        );
      }
      dataSchema = schema;
    }

    const envelope = create(EnvelopeSchema, {
      v: options.version ?? 1,
      t: options.type,
      id: options.id ?? this.generateMessageId(),
      replyTo: options.replyTo ?? "",
      ts: options.ts ?? BigInt(Date.now()),
      room: options.room ?? "",
      from: options.from ?? "",
      to: options.to,
      data: anyPack(dataSchema, options.data),
    });

    return this.codec.encode(envelope);
  }

  /**
   * Decode an envelope from JSON.
   */
  decode(encoded: EncodedValue): Envelope {
    return this.codec.decode(encoded);
  }

  /**
   * Decode and unpack an envelope with typed data.
   */
  decodeAndUnpack<S extends DescMessage>(
    encoded: EncodedValue,
    dataSchema: S
  ): UnpackedEnvelope<MessageShape<S>> | null {
    const envelope = this.decode(encoded);

    if (!envelope.data) {
      return null;
    }

    const data = anyUnpack(envelope.data, dataSchema);
    if (!data) {
      return null;
    }

    return { data, envelope };
  }

  /**
   * Unpack data from an already-decoded envelope.
   */
  unpack<S extends DescMessage>(
    envelope: Envelope,
    dataSchema: S
  ): MessageShape<S> | null {
    if (!envelope.data) {
      return null;
    }

    const result = anyUnpack(envelope.data, dataSchema);
    return result ?? null;
  }

  /**
   * Generate a unique message ID.
   */
  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}

/**
 * Create a singleton instance for JSON envelopes.
 */
export const defaultJSONEnvelopeBuilder = new EnvelopeBuilder(
  new ProtoJSONCodec()
);

/**
 * Create a singleton instance for binary envelopes.
 */
export const defaultBinaryEnvelopeBuilder = new EnvelopeBuilder(
  new ProtoBinaryCodec()
);
