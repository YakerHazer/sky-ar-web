import { useCallback, useRef, useState } from "react";

export type GeoStatus = "idle" | "locating" | "ok" | "denied" | "unsupported" | "error";

export interface GeoResult {
  lat: number;
  lon: number;
  /** GPS accuracy in meters, if reported. */
  accuracy?: number;
  ts: number;
}

/**
 * Resolve the device's GPS position (high accuracy) so the aircraft feed and
 * sky math are centered on where the user actually stands. Falls back silently
 * to the configured default on failure — callers must surface the status so the
 * fallback isn't mistaken for a real fix. Persists nothing itself; the caller
 * writes the fix into config (so it survives reloads).
 */
export function useGeolocation(): {
  status: GeoStatus;
  result: GeoResult | null;
  /** Request/refresh the position. `onResult` fires on a successful fix. */
  request: (onResult: (lat: number, lon: number) => void) => void;
} {
  const [status, setStatus] = useState<GeoStatus>(() =>
    typeof navigator === "undefined" || !navigator.geolocation ? "unsupported" : "idle",
  );
  const [result, setResult] = useState<GeoResult | null>(null);
  // Keep the latest callback so retries (and a late first fix) reach it.
  const cbRef = useRef<(lat: number, lon: number) => void>(() => {});

  const request = useCallback((onResult: (lat: number, lon: number) => void) => {
    cbRef.current = onResult;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const r: GeoResult = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ts: Date.now(),
        };
        setResult(r);
        setStatus("ok");
        cbRef.current(r.lat, r.lon);
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }, []);

  return { status, result, request };
}
