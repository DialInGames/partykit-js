import {
  Message,
  toJson,
  fromJson,
  DescMessage,
  MessageShape,
  JsonValue,
} from "@bufbuild/protobuf";
import type { Registry } from "@bufbuild/protobuf";

/**
 * JSON codec for Bufbuild protobuf messages.
 * JSON-first. Easy to add binary later.
 */
export class ProtoJsonCodec {
  constructor(private readonly registry?: Registry) {}

  encode<S extends DescMessage, T extends MessageShape<S>>(
    schema: S,
    msg: T
  ): unknown {
    return toJson(schema, msg, { registry: this.registry });
  }

  decode<S extends DescMessage>(schema: S, json: JsonValue): MessageShape<S> {
    return fromJson(schema, json, { registry: this.registry });
  }
}
