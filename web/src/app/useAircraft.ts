import { useCallback, useEffect, useRef, useState } from "react";
import type { Aircraft, SourceStatus, Tle } from "@shared/index.js";

interface AircraftSnapshot {
  now: number;
  aircraft: Aircraft[];
}

/**
 * Poll the serverless aircraft API around the configured location, plus fetch
 * satellite TLEs (refreshed hourly) so the renderer can compute ISS/satellite
 * positions client-side. Returns the latest snapshot + feed health for the HUD.
 */
export function useAircraft(
  getCenter: () => { lat: number; lon: number },
  radiusMiles: number,
  pollMs: number,
): {
  aircraft: Aircraft[];
  status: SourceStatus | null;
  tles: Tle[];
  refresh: () => void;
} {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [tles, setTles] = useState<Tle[]>([]);
  const tlesRef = useRef<Tle[]>([]);
  tlesRef.current = tles;

  const fetchTles = useCallback(async () => {
    try {
      const res = await fetch("/api/tle");
      if (res.ok) {
        const list = (await res.json()) as Tle[];
        if (Array.isArray(list)) {
          setTles(list);
          tlesRef.current = list;
        }
      }
    } catch {
      /* keep whatever we have */
    }
  }, []);

  const poll = useCallback(async () => {
    const { lat, lon } = getCenter();
    const url = `/api/aircraft?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&r=${Math.round(radiusMiles)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snap = (await res.json()) as AircraftSnapshot;
      setAircraft(snap.aircraft ?? []);
      setStatus({
        source: "api",
        ok: true,
        count: snap.aircraft?.length ?? 0,
        lastOk: Date.now(),
      });
    } catch (e) {
      setStatus({
        source: "api",
        ok: false,
        count: 0,
        lastOk: null,
        message: e instanceof Error ? e.message : "fetch failed",
      });
    }
  }, [getCenter, radiusMiles]);

  // TLEs on mount + hourly refresh.
  useEffect(() => {
    void fetchTles();
    const id = setInterval(() => void fetchTles(), 3600_000);
    return () => clearInterval(id);
  }, [fetchTles]);

  // Aircraft polling on the configured cadence. Re-arms when the radius/cadence
  // change; the closure always reads the latest center via the getter.
  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), Math.max(2000, pollMs));
    return () => clearInterval(id);
  }, [poll, pollMs]);

  return { aircraft, status, tles, refresh: () => void poll() };
}
