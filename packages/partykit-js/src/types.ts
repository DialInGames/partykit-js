import type { ClientContext } from "@dialingames/partykit-protocol";

/**
 * Session state for a connected client.
 */
export type Session<TSessionData = unknown> = {
  /** Client context from authentication */
  context: ClientContext;
  /** Whether the client is currently connected */
  isConnected: boolean;
  /** Timestamp when the client disconnected (undefined if connected) */
  disconnectedAt?: number;
  /** Custom session data (game-specific) */
  data?: TSessionData;
};

/**
 * Events emitted by the SessionManager.
 */
export type SessionEvent<TSessionData = unknown> =
  | {
      type: "connected";
      clientId: string;
      session: Session<TSessionData>;
      isReconnect: boolean;
    }
  | {
      type: "disconnected";
      clientId: string;
      session: Session<TSessionData>;
    }
  | {
      type: "timeout";
      clientId: string;
      session: Session<TSessionData>;
    };

/**
 * Hooks for SessionManager lifecycle events.
 */
export type SessionHooks<TSessionData = unknown> = {
  /**
   * Called when a client connects or reconnects.
   * @param clientId - The client's stable ID
   * @param session - The session object
   * @param isReconnect - True if this is a reconnection, false if it's a new connection
   */
  onConnected?: (
    clientId: string,
    session: Session<TSessionData>,
    isReconnect: boolean
  ) => void | Promise<void>;

  /**
   * Called when a client disconnects.
   * The grace period timer starts after this hook completes.
   * @param clientId - The client's stable ID
   * @param session - The session object (marked as disconnected)
   */
  onDisconnected?: (
    clientId: string,
    session: Session<TSessionData>
  ) => void | Promise<void>;

  /**
   * Called when a client's grace period expires without reconnecting.
   * This is where you should clean up the session permanently.
   * @param clientId - The client's stable ID
   * @param session - The session object that timed out
   */
  onTimeout?: (
    clientId: string,
    session: Session<TSessionData>
  ) => void | Promise<void>;
};

/**
 * Configuration options for SessionManager.
 */
export type SessionManagerOptions<TSessionData = unknown> = {
  /** Enable reconnection support (default: true) */
  enableReconnection?: boolean;
  /** Grace period in milliseconds before a disconnected session times out (default: 60000, only used if enableReconnection is true) */
  gracePeriodMs?: number;
  /** Hooks for session lifecycle events */
  hooks?: SessionHooks<TSessionData>;
};
