// Client-facing data contracts for the AR sky app. The browser polls the
// Vercel serverless API (no WebSocket, no LAN appliance); these are the shapes
// it speaks.

/** Where a snapshot came from + its health (shown in the HUD). */
export interface SourceStatus {
  /** Data feed that produced the snapshot (e.g. "api"). */
  source: string;
  /** Whether the most recent poll succeeded. */
  ok: boolean;
  /** Number of aircraft in the last snapshot. */
  count: number;
  /** Last successful poll (ms epoch), or null. */
  lastOk: number | null;
  /** Human-readable note (e.g. last error / rate-limit message). */
  message?: string;
}
