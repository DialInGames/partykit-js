import type {
  HelloOk,
  HelloError,
  ClientContext,
} from "@dialingames/partykit-protocol";

export type PartyKitEnvelopeTarget = "broadcast" | "server" | string;

/**
 * Internal result type for the authorizeHello hook.
 * Returns either a ClientContext or an error that will be converted to HelloError.
 */
export type PartyKitAuthResult =
  | { ok: true; context: ClientContext }
  | {
      ok: false;
      code: string;
      message: string;
      retryable?: boolean;
      details?: Uint8Array;
    };
