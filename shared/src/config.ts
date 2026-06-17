// Central, fully-adjustable configuration for the AR sky app.
// Each client persists its own copy in localStorage (there's no LAN appliance
// anymore), and every field is live-tunable from the in-app settings drawer.

export type Theme = "ambient" | "telemetry" | "focus";
/** map = flat ground plan; sky = look-up dome (kept for the geo helpers + tests;
 *  the AR app always projects through the live camera view instead). */
export type ProjectionMode = "map" | "sky";
export type LabelDensity = "all" | "nearestN" | "nearestOnly";
/** Ground-speed display unit. ADS-B reports knots; the rest are converted. */
export type SpeedUnit = "kt" | "mph" | "kmh";

export interface Palette {
  bg: string;
  glyph: string;
  trail: string;
  accent: string;
  warn: string;
  /** Reticle / compass ticks. */
  grid: string;
  /** Label / card text. */
  text: string;
}

export interface Fonts {
  label: string;
  mono: string;
}

/** A saved place you can jump the view to from the settings drawer. */
export interface LocationProfile {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusMiles: number;
}

export interface ShowFields {
  airline: boolean;
  flight: boolean;
  type: boolean;
  altitude: boolean;
  speed: boolean;
  verticalRate: boolean;
  destination: boolean;
  registration: boolean;
}

/** Manual calibration offsets for the device orientation → camera view mapping.
 *  Device compasses/accelerometers disagree by a few degrees and true north vs
 *  magnetic north adds more; these let a user pin the overlay to the real sky. */
export interface OrientationTrim {
  /** Yaw / heading offset, degrees (added to azimuth). */
  yawDeg: number;
  /** Pitch offset, degrees (added to altitude). */
  pitchDeg: number;
  /** Roll offset, degrees (rotates the overlay around the boresight). */
  rollDeg: number;
}

export interface Config {
  // --- location & scope ---
  centerLat: number;
  centerLon: number;
  /** Human-readable place name (shown in the panel). */
  locationName: string;
  radiusMiles: number;
  /** Saved places (airports/cities) switchable from the settings drawer. */
  locationProfiles: LocationProfile[];

  // --- filtering ---
  minAltitudeFt: number;
  maxAltitudeFt: number;
  hideOnGround: boolean;

  // --- motion ---
  /** Display interpolation toggle (poll cadence is separate). */
  interpolate: boolean;
  maxExtrapolationSec: number;
  staleSec: number;
  /** Ease factor toward each fresh fix (0 = snap, 1 = never move). */
  smoothing: number;
  /** Cap the render loop, frames per second. 0 = uncapped. */
  maxFps: number;

  // --- visuals ---
  theme: Theme;
  palette: Palette;
  fonts: Fonts;
  glyphSizePx: number;
  /** Color the glyph by altitude. */
  altitudeColor: boolean;
  trailSeconds: number;
  /** Global brightness 0..1. */
  brightness: number;

  // --- labels ---
  labelDensity: LabelDensity;
  nearestN: number;
  showFields: ShowFields;
  /** Unit for the speed shown on labels (ADS-B is knots). */
  speedUnit: SpeedUnit;

  // --- AR camera + orientation ---
  /** Estimated horizontal field of view of the back camera, degrees. */
  fovDeg: number;
  /** Manual orientation calibration offsets. */
  orientationTrim: OrientationTrim;
  /** Aircraft data poll interval, ms. */
  pollMs: number;
  /** Center crosshair + FOV frame so you can see where the camera is aimed. */
  showReticle: boolean;
  /** Heading tape along the top edge of the frame. */
  showCompass: boolean;
  highlightEmergency: boolean;

  // --- sky layer (sun / moon / stars / satellites / planets at true positions) ---
  showStars: boolean;
  showSun: boolean;
  showMoon: boolean;
  showSatellites: boolean; // includes the ISS
  /** Label non-ISS satellites with their names (the ISS is always labelled). */
  satelliteLabels: boolean;
  /** Draw the naked-eye planets (Venus, Jupiter, Mars, Saturn, Mercury). */
  showPlanets: boolean;
  /** Faintest star magnitude to draw (higher = more stars). */
  starMagLimit: number;
  /** Faintest star magnitude to label with its name (higher = more names). */
  starLabelMagLimit: number;
  /** Offset the sky clock for testing/scrubbing, minutes (0 = live). */
  skyTimeOffsetMin: number;
}

export const DEFAULT_CONFIG: Config = {
  // Default center: San Francisco International (SFO). The app will ask for your
  // GPS on first run, but this is the fallback.
  centerLat: 37.6213,
  centerLon: -122.379,
  locationName: "San Francisco International",
  radiusMiles: 8,
  locationProfiles: [],

  minAltitudeFt: 100,
  maxAltitudeFt: 60000,
  hideOnGround: true,

  interpolate: true,
  maxExtrapolationSec: 5,
  staleSec: 30,
  smoothing: 0.18,
  maxFps: 0,

  theme: "ambient",
  palette: {
    bg: "#000000",
    glyph: "#E8ECFF",
    trail: "#6B7280",
    accent: "#9B7ECF",
    warn: "#FF5A47",
    grid: "#3A4256",
    text: "#AEB6C6",
  },
  fonts: {
    label: "Inter, system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  glyphSizePx: 26,
  altitudeColor: true,
  trailSeconds: 45,
  brightness: 1,

  labelDensity: "nearestN",
  nearestN: 6,
  showFields: {
    airline: true,
    flight: true,
    type: true,
    altitude: true,
    speed: true,
    verticalRate: false,
    destination: true,
    registration: false,
  },
  speedUnit: "kt",

  fovDeg: 65,
  orientationTrim: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
  pollMs: 5000,
  showReticle: true,
  showCompass: true,
  highlightEmergency: true,

  showStars: true,
  showSun: true,
  showMoon: true,
  showSatellites: true,
  satelliteLabels: false,
  showPlanets: true,
  starMagLimit: 2.6,
  starLabelMagLimit: 0.3,
  skyTimeOffsetMin: 0,
};

/**
 * Deep-merge a partial config onto a base, so persisted/partial payloads never
 * drop nested keys (palette, showFields, fonts, orientationTrim).
 */
export function mergeConfig(base: Config, patch: Partial<Config>): Config {
  return {
    ...base,
    ...patch,
    palette: { ...base.palette, ...(patch.palette ?? {}) },
    fonts: { ...base.fonts, ...(patch.fonts ?? {}) },
    showFields: { ...base.showFields, ...(patch.showFields ?? {}) },
    orientationTrim: { ...base.orientationTrim, ...(patch.orientationTrim ?? {}) },
  };
}
