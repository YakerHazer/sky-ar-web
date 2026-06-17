import { useCallback, useState } from "react";

export type GeoStatus = "idle" | "locating" | "ok" | "denied" | "unsupported" | "error";

/**
 * Resolve the device's GPS position once (high accuracy) so the aircraft feed
 * and sky math are centered on where the user actually stands. Falls back
 * silently to the configured default (SFO) on any failure.
 */
export function useGeolocation(): {
  status: GeoStatus;
  request: (onResult: (lat: number, lon: number) => void) => void;
} {
  const [status, setStatus] = useState<GeoStatus>(() =>
    typeof navigator === "undefined" || !navigator.geolocation ? "unsupported" : "idle",
  );

  const request = useCallback(
    (onResult: (lat: number, lon: number) => void) => {
      if (!navigator.geolocation) {
        setStatus("unsupported");
        return;
      }
      setStatus("locating");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setStatus("ok");
          onResult(pos.coords.latitude, pos.coords.longitude);
        },
        (err) => {
          setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    },
    [],
  );

  return { status, request };
}
