/**
 * Utility functions for PartyKit protocol implementation.
 */

/**
 * Generate a unique message ID for envelope correlation.
 * Format: {timestamp}-{random}
 */
export function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return `${timestamp}-${random}`;
}

/**
 * Generate a human-friendly room code (4-6 uppercase alphanumeric characters).
 * Excludes ambiguous characters (0, O, I, 1, etc.)
 */
export function generateRoomCode(length: number = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No 0,O,I,1
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Standard PartyKit error codes from the protocol specification.
 */
export const ErrorCodes = {
  AUTH_FAILED: "AUTH_FAILED",
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_FULL: "ROOM_FULL",
  UNAUTHORIZED: "UNAUTHORIZED",
  BAD_REQUEST: "BAD_REQUEST",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_STATE: "INVALID_STATE",
  TIMEOUT: "TIMEOUT",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];