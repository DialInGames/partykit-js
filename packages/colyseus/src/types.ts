import { ClientKind } from "@buf/dialingames_partykit.bufbuild_es/v1/connection_pb";
import { Role } from "@buf/dialingames_partykit.bufbuild_es/v1/presence_pb";
import { RoomVisibility } from "@buf/dialingames_partykit.bufbuild_es/v1/room_pb";

export type PartyKitClientContext = {
  clientId: string; // stable id within the room session
  kind: ClientKind;
  displayName?: string;
  role: Role;
  capabilities: string[];
  groups: string[];
  metadata: Record<string, string>;
  reconnectToken?: string;
};

export type PartyKitAuthResult =
  | { ok: true; context: PartyKitClientContext }
  | {
      ok: false;
      code: string;
      message: string;
      retryable?: boolean;
      details?: unknown;
    };

export type PartyKitEnvelopeTarget = "broadcast" | "server" | string;

export type PartyKitRoomInfo = {
  id: string;
  code?: string;
  type: string;
  visibility?: RoomVisibility;
  maxClients?: number;
};
