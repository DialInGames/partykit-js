import { JsonValue } from "@bufbuild/protobuf";
import { ProtoJsonCodec } from "./ProtoJsonCodec.js";
import {
  Envelope,
  EnvelopeSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/envelope_pb";

/**
 * Encodes/decodes the PartyKit Envelope over Colyseus messages.
 *
 * Convention:
 * - Colyseus message type = Envelope.t
 * - Colyseus payload = JSON object representing Envelope (protobuf JSON mapping)
 */
export class EnvelopeCodec {
  private readonly json = new ProtoJsonCodec();

  encodeEnvelope(env: Envelope): unknown {
    return this.json.encode(EnvelopeSchema, env);
  }

  decodeEnvelope(payload: unknown): Envelope {
    return this.json.decode(EnvelopeSchema, payload as JsonValue);
  }
}
