import { Client, Deferred, Room } from "colyseus";
import { SessionManager, type Session } from "@dialingames/partykit-js";
import type { SessionManagerOptions } from "@dialingames/partykit-js";

/**
 * Extended SessionManager that integrates with Colyseus reconnection system.
 */
export class ColyseusSessionManager<
  TSessionData = unknown
> extends SessionManager<TSessionData> {
  /** Track deferred clients awaiting reconnection (clientId -> deferred client) */
  private readonly deferredClients = new Map<string, Deferred<Client>>();

  constructor(options: SessionManagerOptions<TSessionData> = {}) {
    // Wrap the hooks to add deferred client management
    const wrappedHooks = {
      ...options.hooks,
      onConnected: async (
        clientId: string,
        session: Session<TSessionData>,
        isReconnect: boolean
      ) => {
        // Clear deferred client on successful reconnection
        if (isReconnect) {
          this.deferredClients.delete(clientId);
        }
        await options.hooks?.onConnected?.(clientId, session, isReconnect);
      },
      onTimeout: async (clientId: string, session: Session<TSessionData>) => {
        // Reject deferred client if reconnection timed out
        const deferredClient = this.deferredClients.get(clientId);
        if (deferredClient) {
          try {
            await deferredClient.reject();
          } catch (err) {
            // Ignore errors from rejecting deferred client
          }
          this.deferredClients.delete(clientId);
        }
        await options.hooks?.onTimeout?.(clientId, session);
      },
    };

    super({ ...options, hooks: wrappedHooks });
  }

  /**
   * Store a deferred client for a given clientId.
   * This should be called when a client disconnects and reconnection is allowed.
   * The deferred client will be automatically rejected if the session times out.
   */
  setDeferredClient(
    clientId: string,
    deferredClient: ReturnType<Room["allowReconnection"]>
  ) {
    this.deferredClients.set(clientId, deferredClient);
  }

  /**
   * Remove a deferred client without rejecting it.
   * Useful if you need to clear the deferred client for other reasons.
   */
  clearDeferredClient(clientId: string) {
    this.deferredClients.delete(clientId);
  }

  /**
   * Get a deferred client by clientId.
   */
  getDeferredClient(
    clientId: string
  ): ReturnType<Room["allowReconnection"]> | undefined {
    return this.deferredClients.get(clientId);
  }
}
