import type { ClientContext } from "@dialingames/partykit-protocol";
import type {
  Session,
  SessionEvent,
  SessionHooks,
  SessionManagerOptions,
} from "./types.js";

/**
 * SessionManager handles client session lifecycle including reconnection logic.
 * It's implementation-agnostic and can be used with any server framework.
 */
export class SessionManager<TSessionData = unknown> {
  private readonly sessions = new Map<string, Session<TSessionData>>();
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly enableReconnection: boolean;
  private readonly gracePeriodMs: number;
  private readonly hooks: SessionHooks<TSessionData>;

  constructor(options: SessionManagerOptions<TSessionData> = {}) {
    this.enableReconnection = options.enableReconnection ?? true;
    this.gracePeriodMs = options.gracePeriodMs ?? 60000; // Default 60 seconds
    this.hooks = options.hooks ?? {};
  }

  /**
   * Register or reconnect a client session.
   * If reconnection is disabled, existing sessions are not checked.
   * @param clientId - The stable client ID
   * @param context - The client context from authentication
   * @param initialData - Optional initial session data for new sessions
   * @returns The session object and whether this was a reconnection
   */
  async connect(
    clientId: string,
    context: ClientContext,
    initialData?: TSessionData
  ): Promise<{ session: Session<TSessionData>; isReconnect: boolean }> {
    const existing = this.enableReconnection
      ? this.sessions.get(clientId)
      : undefined;

    if (existing) {
      // Reconnection - cancel disconnect timer
      const timer = this.disconnectTimers.get(clientId);
      if (timer) {
        clearTimeout(timer);
        this.disconnectTimers.delete(clientId);
      }

      // Update session state
      existing.isConnected = true;
      existing.disconnectedAt = undefined;
      existing.context = context; // Update context in case it changed

      await this.hooks.onConnected?.(clientId, existing, true);

      return { session: existing, isReconnect: true };
    } else {
      // New session
      const session: Session<TSessionData> = {
        context,
        isConnected: true,
        data: initialData,
      };

      this.sessions.set(clientId, session);

      await this.hooks.onConnected?.(clientId, session, false);

      return { session, isReconnect: false };
    }
  }

  /**
   * Mark a client as disconnected and optionally start the grace period timer.
   * If reconnection is disabled, the session is immediately removed.
   * @param clientId - The stable client ID
   * @returns The session object if it exists, undefined otherwise
   */
  async disconnect(
    clientId: string
  ): Promise<Session<TSessionData> | undefined> {
    const session = this.sessions.get(clientId);
    if (!session) {
      return undefined;
    }

    // Mark as disconnected
    session.isConnected = false;
    session.disconnectedAt = Date.now();

    await this.hooks.onDisconnected?.(clientId, session);

    if (this.enableReconnection) {
      // Start grace period timer
      const timer = setTimeout(async () => {
        await this.handleTimeout(clientId);
      }, this.gracePeriodMs);

      this.disconnectTimers.set(clientId, timer);
    } else {
      // Immediately remove session if reconnection is disabled
      await this.hooks.onTimeout?.(clientId, session);
      this.sessions.delete(clientId);
    }

    return session;
  }

  /**
   * Get a session by client ID.
   */
  get(clientId: string): Session<TSessionData> | undefined {
    return this.sessions.get(clientId);
  }

  /**
   * Get all sessions.
   */
  all(): Session<TSessionData>[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get all connected sessions.
   */
  connected(): Session<TSessionData>[] {
    return this.all().filter((s) => s.isConnected);
  }

  /**
   * Get all disconnected sessions (in grace period).
   */
  disconnected(): Session<TSessionData>[] {
    return this.all().filter((s) => !s.isConnected);
  }

  /**
   * Check if a client has an active session (connected or in grace period).
   */
  has(clientId: string): boolean {
    return this.sessions.has(clientId);
  }

  /**
   * Immediately remove a session without triggering timeout hook.
   * Useful for manual cleanup.
   */
  remove(clientId: string): boolean {
    const timer = this.disconnectTimers.get(clientId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(clientId);
    }
    return this.sessions.delete(clientId);
  }

  /**
   * Clear all sessions and timers.
   */
  clear(): void {
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    this.sessions.clear();
  }

  /**
   * Get the number of sessions (connected + disconnected).
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Get the number of connected sessions.
   */
  get connectedCount(): number {
    return this.connected().length;
  }

  /**
   * Handle session timeout (grace period expired).
   */
  private async handleTimeout(clientId: string): Promise<void> {
    const session = this.sessions.get(clientId);
    if (!session) {
      return;
    }

    this.disconnectTimers.delete(clientId);

    await this.hooks.onTimeout?.(clientId, session);

    // Remove the session after timeout hook completes
    this.sessions.delete(clientId);
  }
}
