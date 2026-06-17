import { useCallback, useMemo, useState } from "react";
import { useConfig } from "./useConfig.js";
import { useCamera } from "./useCamera.js";
import { useOrientation } from "./useOrientation.js";
import { useAircraft } from "./useAircraft.js";
import { useGeolocation } from "./useGeolocation.js";
import { ArView } from "./ArView.js";
import { Settings } from "./Settings.js";

export function App() {
  const { config, patch, reset, ref } = useConfig();
  const [started, setStarted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** True once a real GPS fix has been applied to the config center. */
  const [gpsApplied, setGpsApplied] = useState(false);

  const camera = useCamera();
  const geo = useGeolocation();

  // Stable getters so the polling/orientation/render loops read fresh config
  // without resubscribing.
  const getCenter = useCallback(
    () => ({ lat: ref.current.centerLat, lon: ref.current.centerLon }),
    [ref],
  );
  const getTrim = useCallback(() => ref.current.orientationTrim, [ref]);
  const orientation = useOrientation(getTrim);
  const getView = useCallback(() => orientation.viewRef.current, [orientation.viewRef]);

  const { aircraft, status, tles, refresh } = useAircraft(getCenter, config.radiusMiles, config.pollMs);

  const applyGps = useCallback(
    (lat: number, lon: number) => {
      patch({
        centerLat: lat,
        centerLon: lon,
        locationName: `Your location (${lat.toFixed(3)}, ${lon.toFixed(3)})`,
      });
      setGpsApplied(true);
      // The poll effect re-arms when center-derived values change, but force a
      // refresh so the new location's aircraft show immediately.
      refresh();
    },
    [patch, refresh],
  );

  const relocate = useCallback(() => {
    geo.request(applyGps);
  }, [geo, applyGps]);

  const start = useCallback(async () => {
    // All three permissions require a user gesture on iOS — kick them off here.
    geo.request(applyGps);
    void camera.request();
    void orientation.request();
    setStarted(true);
  }, [geo, camera, orientation, applyGps]);

  const showStart = !started;

  const banner = useMemo(() => {
    if (!started) return null;
    if (camera.status === "denied")
      return { text: "Camera permission denied — reload and allow the camera to see the live sky." };
    if (camera.status === "unsupported")
      return { text: "This browser can't open the camera. Try Safari (iOS) or Chrome (Android)." };
    if (orientation.status === "denied")
      return { text: "Motion permission denied — the overlay won't track the camera. Reload to retry." };
    if (orientation.status === "unsupported")
      return { text: "Device orientation isn't available here; the overlay is drawn but won't track panning." };
    // Location problems — all retryable by tapping the banner.
    if (geo.status === "denied")
      return { text: "📍 Location denied — showing the default (San Francisco). Tap to use your GPS.", action: relocate };
    if (geo.status === "error")
      return { text: "📍 Couldn't get your location — showing the default. Tap to retry.", action: relocate };
    if (geo.status === "locating")
      return { text: "📍 Getting your location…" };
    if (!gpsApplied)
      return { text: "📍 Using the default location (San Francisco). Tap to use your GPS.", action: relocate };
    return null;
  }, [started, camera.status, orientation.status, geo.status, gpsApplied, relocate]);

  return (
    <div className="app">
      <ArView
        config={config}
        stream={camera.stream}
        aircraft={aircraft}
        status={status}
        tles={tles}
        getView={getView}
      />

      {started && (
        <>
          <div className="hud">
            <div className={`hud-dot ${status?.ok ? "ok" : "bad"}`} />
            <span>
              {config.locationName}{" "}
              <span className={`hud-loc ${gpsApplied ? "on" : ""}`}>{gpsApplied ? "📍GPS" : "default"}</span>
              {" · "}
              {status?.count ?? 0} ac · {Math.round(orientation.view?.az ?? 0)}°
              {orientation.view ? ` / ${Math.round(orientation.view.alt)}°` : ""}
            </span>
          </div>
          <button className="fab" onClick={() => setShowSettings(true)} aria-label="Settings">
            ⚙
          </button>
          {banner && (
            <div
              className={`banner ${banner.action ? "tap" : ""}`}
              onClick={banner.action}
              role={banner.action ? "button" : undefined}
            >
              {banner.text}
            </div>
          )}
        </>
      )}

      {showStart && (
        <div className="gate">
          <div className="gate-card">
            <h1>Sky AR</h1>
            <p>
              Point your phone at the sky and see the aircraft flying overhead — plus the sun, moon,
              planets and the ISS — pinned to where they really are.
            </p>
            <ul className="gate-perms">
              <li>📷 Back camera</li>
              <li>🧭 Motion &amp; compass</li>
              <li>📍 Your location (sets the live center to where you stand)</li>
            </ul>
            <button className="gate-start" onClick={() => void start()}>
              Start AR
            </button>
            <p className="gate-note">Best outdoors with a clear view of the sky.</p>
          </div>
        </div>
      )}

      {showSettings && (
        <Settings config={config} patch={patch} reset={reset} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
