// AR projection math — the bridge between sky coordinates (azimuth + altitude)
// and camera screen pixels. Pure, no DOM, fully testable.
//
// A sky object lives at (azimuth from true north, altitude above horizon). The
// phone's device orientation tells us where the back camera is pointed (the
// boresight) and how the frame is rolled. From those we build a camera basis
// (forward / screen-right / screen-up) and project every sky object through a
// tangent-plane (pinhole) model — the same geometry a real rectilinear lens
// uses — onto the canvas. Objects behind the camera or outside the field of
// view are culled.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** East/North/Up unit vector. */
export type Enu = readonly [number, number, number];

/** (azimuth° from North, altitude° above horizon) → ENU unit vector. */
export function azAltToEnu(azDeg: number, altDeg: number): Enu {
  const az = azDeg * D2R;
  const alt = altDeg * D2R;
  const ca = Math.cos(alt);
  return [ca * Math.sin(az), ca * Math.cos(az), Math.sin(alt)];
}

/** ENU unit vector → (azimuth°, altitude°). */
export function enuToAzAlt(e: Enu): { az: number; alt: number } {
  const [E, N, U] = e;
  const horiz = Math.hypot(E, N);
  return {
    az: (((Math.atan2(E, N) * R2D) % 360) + 360) % 360,
    alt: Math.atan2(U, horiz) * R2D,
  };
}

function normalize(v: Enu): Enu {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

function cross(a: Enu, b: Enu): Enu {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Enu, b: Enu): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export interface CamView {
  /** Boresight direction (where the camera points), ENU unit vector. */
  forward: Enu;
  /** Screen-right direction in the image plane, ENU unit vector. */
  right: Enu;
  /** Screen-up direction in the image plane, ENU unit vector. */
  up: Enu;
  /** Boresight as (azimuth°, altitude°). */
  az: number;
  alt: number;
}

const WORLD_UP: Enu = [0, 0, 1];

/**
 * Build a camera view from a boresight (az0, alt0) plus a roll angle. `right`
 * and `up` are derived from world-up so that, at zero roll, "up" on screen
 * points toward the zenith — then the whole image plane is rotated by `roll`
 * around the boresight to absorb the device's physical twist.
 */
export function makeCameraView(az0Deg: number, alt0Deg: number, rollDeg: number): CamView {
  const forward = normalize(azAltToEnu(az0Deg, alt0Deg));
  // Natural image basis from world-up. At the zenith the cross product is
  // undefined — fall back to an arbitrary right axis there.
  let rightNat = cross(forward, WORLD_UP);
  if (Math.hypot(rightNat[0], rightNat[1], rightNat[2]) < 1e-6) {
    rightNat = [1, 0, 0];
  }
  rightNat = normalize(rightNat);
  const upNat = normalize(cross(rightNat, forward));

  // Rotate the basis around the boresight by `roll` (Rodrigues).
  const r = rollDeg * D2R;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const right: Enu = [
    rightNat[0] * c + upNat[0] * s,
    rightNat[1] * c + upNat[1] * s,
    rightNat[2] * c + upNat[2] * s,
  ];
  const up: Enu = [
    -rightNat[0] * s + upNat[0] * c,
    -rightNat[1] * s + upNat[1] * c,
    -rightNat[2] * s + upNat[2] * c,
  ];
  return { forward, right, up, az: az0Deg, alt: alt0Deg };
}

export interface ArProjectOpts {
  /** Canvas width, CSS pixels. */
  w: number;
  /** Canvas height, CSS pixels. */
  h: number;
  /** Horizontal field of view, degrees. */
  fovHdeg: number;
  /** Vertical field of view, degrees (0 → derive from aspect + hfov). */
  fovVdeg?: number;
}

export interface ProjectResult {
  /** Screen x (CSS px), undefined when behind the camera. */
  x?: number;
  /** Screen y (CSS px, origin top). */
  y?: number;
  /** Angular distance from the boresight, degrees (always set). */
  sepDeg: number;
  /** On the camera side of the hemisphere (in front of the lens). */
  inFront: boolean;
}

/** Project a sky direction (az°, alt°) through a camera view to screen coords. */
export function projectAzAlt(
  azDeg: number,
  altDeg: number,
  view: CamView,
  o: ArProjectOpts,
): ProjectResult {
  const p = azAltToEnu(azDeg, altDeg);
  const z = dot(p, view.forward); // depth along boresight
  const sepDeg = Math.acos(Math.max(-1, Math.min(1, z))) * R2D;
  if (z <= 0.02) return { sepDeg, inFront: false };

  // Tangent-plane (gnomonic) coordinates.
  const sx = dot(p, view.right) / z;
  const sy = dot(p, view.up) / z;

  const hfov = o.fovHdeg * D2R;
  const fx = (o.w / 2) / Math.tan(hfov / 2);
  const vfov = (o.fovVdeg ?? 0) > 0 ? (o.fovVdeg as number) * D2R : 2 * Math.atan(Math.tan(hfov / 2) * (o.h / o.w));
  const fy = (o.h / 2) / Math.tan(vfov / 2);

  return {
    x: o.w / 2 + sx * fx,
    y: o.h / 2 - sy * fy,
    sepDeg,
    inFront: true,
  };
}

/** Angular separation between two sky directions, degrees. */
export function angularSepDeg(az1: number, alt1: number, az2: number, alt2: number): number {
  const a = azAltToEnu(az1, alt1);
  const b = azAltToEnu(az2, alt2);
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * R2D;
}

/** Rotate vector `v` around a unit `axis` by `deg` (Rodrigues). */
export function rotateAroundAxis(v: Enu, axis: Enu, deg: number): Enu {
  const r = deg * D2R;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const k = axis;
  const d = dot(v, k);
  return [
    v[0] * c + (cross(k, v))[0] * s + k[0] * d * (1 - c),
    v[1] * c + (cross(k, v))[1] * s + k[1] * d * (1 - c),
    v[2] * c + (cross(k, v))[2] * s + k[2] * d * (1 - c),
  ];
}

/** Package three orthonormal ENU axes (from a device rotation matrix) as a view. */
export function makeCamViewFromBasis(forward: Enu, right: Enu, up: Enu): CamView {
  const f = normalize(forward);
  const { az, alt } = enuToAzAlt(f);
  return { forward: f, right: normalize(right), up: normalize(up), az, alt };
}

/**
 * Apply small manual calibration offsets to a camera view: yaw around the local
 * vertical (true/magnetic north error), pitch around the view's right axis, and
 * roll around the boresight. Order: yaw → pitch → roll. Let a user pin the
 * overlay to the real sky against their device's compass/accelerometer drift.
 */
export function applyOrientationTrim(
  view: CamView,
  yawDeg: number,
  pitchDeg: number,
  rollDeg: number,
): CamView {
  const zAxis: Enu = [0, 0, 1];
  let f = view.forward;
  let r = view.right;
  let u = view.up;
  // Yaw around the world vertical.
  if (yawDeg) {
    f = rotateAroundAxis(f, zAxis, yawDeg);
    r = rotateAroundAxis(r, zAxis, yawDeg);
    u = rotateAroundAxis(u, zAxis, yawDeg);
  }
  // Pitch around the (rotated) right axis.
  if (pitchDeg) {
    f = rotateAroundAxis(f, r, pitchDeg);
    u = rotateAroundAxis(u, r, pitchDeg);
  }
  // Roll around the (rotated) boresight.
  if (rollDeg) {
    r = rotateAroundAxis(r, f, rollDeg);
    u = rotateAroundAxis(u, f, rollDeg);
  }
  const { az, alt } = enuToAzAlt(f);
  return { forward: normalize(f), right: normalize(r), up: normalize(u), az, alt };
}
