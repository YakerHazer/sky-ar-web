import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyOrientationTrim,
  makeCamViewFromBasis,
  type CamView,
  type Enu,
  type OrientationTrim,
} from "@shared/index.js";

export type OrientationStatus = "idle" | "prompted" | "granted" | "denied" | "unsupported";

const D2R = Math.PI / 180;

interface DeviceOrientEventLike extends Event {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
  webkitCompassHeading?: number;
}

type DeviceOrientCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/**
 * Build a camera view from a `deviceorientation` reading. The W3C device→world
 * (ENU) rotation matrix maps the device's screen axes onto east/north/up; the
 * back camera looks along −device-Z, the image right is +device-X, image up is
 * +device-Y — so the live roll of the phone is captured for free. iOS gives a
 * more reliable compass heading via `webkitCompassHeading`, which we prefer over
 * `alpha`.
 *
 * Device compasses/accelerometers and true-vs-magnetic north introduce a few
 * degrees of error; the caller applies `trim` (from the settings drawer) so a
 * user can pin the overlay to the real sky (e.g. against the sun or moon).
 */
function viewFromEvent(ev: DeviceOrientEventLike, trim: OrientationTrim): CamView | null {
  const beta = ev.beta;
  const gamma = ev.gamma;
  if (beta == null || gamma == null) return null;

  // alpha: prefer iOS compass heading; else the (absolute) alpha.
  let alpha: number | null = null;
  if (typeof ev.webkitCompassHeading === "number") {
    alpha = 360 - ev.webkitCompassHeading;
  } else if (ev.alpha != null) {
    alpha = ev.alpha;
  }
  if (alpha == null) return null;

  const a = alpha * D2R;
  const b = beta * D2R;
  const g = gamma * D2R;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);
  const cg = Math.cos(g), sg = Math.sin(g);

  // Device → world (ENU) rotation matrix, W3C intrinsic Z(α)·X'(β)·Y''(γ).
  const m = [
    [ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg],
    [sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg],
    [-cb * sg, sb, cb * cg],
  ];

  const col = (j: number): Enu => [m[0][j], m[1][j], m[2][j]];
  const right = col(0); // device +X (screen right)
  const up = col(1); // device +Y (screen up)
  const f: Enu = [-m[0][2], -m[1][2], -m[2][2]]; // back camera = -device Z

  return applyOrientationTrim(
    makeCamViewFromBasis(f, right, up),
    trim.yawDeg,
    trim.pitchDeg,
    trim.rollDeg,
  );
}

/**
 * Subscribe to device orientation and expose the latest camera view (in a ref,
 * for the render loop) plus a coarse status for the permission gate.
 */
export function useOrientation(getTrim: () => OrientationTrim): {
  view: CamView | null;
  viewRef: React.MutableRefObject<CamView | null>;
  status: OrientationStatus;
  request: () => Promise<void>;
} {
  const [view, setView] = useState<CamView | null>(null);
  const viewRef = useRef<CamView | null>(null);
  const [status, setStatus] = useState<OrientationStatus>(() => {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      return "unsupported";
    }
    return "idle";
  });
  const attachedRef = useRef(false);

  const attach = useCallback(() => {
    if (attachedRef.current) return;
    attachedRef.current = true;
    const handler = (ev: Event) => {
      const v = viewFromEvent(ev as DeviceOrientEventLike, getTrim());
      if (v) {
        viewRef.current = v;
        setView(v);
      }
    };
    // `absolute` (compass-anchored) is preferred where available; iOS fires the
    // plain event with webkitCompassHeading.
    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
  }, [getTrim]);

  const request = useCallback(async () => {
    const Ctor = window.DeviceOrientationEvent as DeviceOrientCtor | undefined;
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    setStatus("prompted");
    try {
      if (typeof Ctor.requestPermission === "function") {
        const res = await Ctor.requestPermission();
        if (res !== "granted") {
          setStatus("denied");
          return;
        }
      }
      setStatus("granted");
      attach();
    } catch {
      setStatus("denied");
    }
  }, [attach]);

  // If no permission gate is needed (Android often fires events without one),
  // attach eagerly and flip to granted once the first event lands.
  useEffect(() => {
    if (status !== "idle") return;
    const Ctor = window.DeviceOrientationEvent as DeviceOrientCtor | undefined;
    const needsPrompt = !!Ctor && typeof Ctor.requestPermission === "function";
    if (needsPrompt) return; // wait for the user to tap "start"
    const probe = (ev: Event) => {
      if ((ev as DeviceOrientEventLike).alpha != null || (ev as DeviceOrientEventLike).webkitCompassHeading != null) {
        attach();
        setStatus("granted");
        window.removeEventListener("deviceorientationabsolute", probe, true);
        window.removeEventListener("deviceorientation", probe, true);
      }
    };
    window.addEventListener("deviceorientationabsolute", probe, true);
    window.addEventListener("deviceorientation", probe, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", probe, true);
      window.removeEventListener("deviceorientation", probe, true);
    };
  }, [status, attach]);

  return { view, viewRef, status, request };
}
