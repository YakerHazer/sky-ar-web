// AR tangent-plane projection. Locks in the sky→screen mapping so a body at the
// boresight lands dead center, the cardinal offsets land on the right axes, and
// objects behind the camera are culled.

import { describe, expect, it } from "vitest";
import {
  azAltToEnu,
  enuToAzAlt,
  makeCameraView,
  projectAzAlt,
  angularSepDeg,
} from "../src/ar.js";

describe("az/alt ↔ ENU round trip", () => {
  it("is the identity for canonical directions", () => {
    expect(enuToAzAlt(azAltToEnu(0, 0))).toMatchObject({ az: 0, alt: 0 }); // north horizon
    expect(enuToAzAlt(azAltToEnu(90, 0))).toMatchObject({ az: 90, alt: 0 }); // east horizon
    expect(enuToAzAlt(azAltToEnu(0, 90))).toMatchObject({ az: 0, alt: 90 }); // zenith
  });
});

describe("projectAzAlt", () => {
  const o = { w: 1000, h: 1000, fovHdeg: 90 };

  it("places the boresight body at screen center", () => {
    const view = makeCameraView(137, 30, 0);
    const r = projectAzAlt(137, 30, view, o);
    expect(r.inFront).toBe(true);
    expect(r.x).toBeCloseTo(500, 1);
    expect(r.y).toBeCloseTo(500, 1);
    expect(r.sepDeg).toBeCloseTo(0, 3);
  });

  it("places a due-right body on the right edge (90° FOV, ±45° at the edges)", () => {
    // Looking due north at the horizon; a body due east (az 90, +0 az offset
    // ... east is +90 az) is 90° away — past the 45° half-FOV, so off-screen,
    // but still in front. Use a 45° offset instead: az 45 from a due-north view.
    const view = makeCameraView(0, 0, 0);
    const r = projectAzAlt(45, 0, view, o);
    expect(r.inFront).toBe(true);
    expect(r.x).toBeGreaterThan(500); // to the right
    expect(r.y).toBeCloseTo(500, 1); // level with boresight (same altitude)
    expect(r.x).toBeCloseTo(1000, 0); // ~right edge for 45° at 90° FOV
  });

  it("places a higher body above the boresight", () => {
    const view = makeCameraView(0, 10, 0);
    const r = projectAzAlt(0, 25, view, o); // 15° above the boresight
    expect(r.inFront).toBe(true);
    expect(r.y).toBeLessThan(500); // screen up = smaller y
  });

  it("culls objects behind the camera", () => {
    const view = makeCameraView(0, 0, 0); // looking north
    const r = projectAzAlt(180, 0, view, o); // due south = behind
    expect(r.inFront).toBe(false);
    expect(r.x).toBeUndefined();
  });
});

describe("angularSepDeg", () => {
  it("is zero for identical directions and 90 for the zenith from the horizon", () => {
    expect(angularSepDeg(40, 20, 40, 20)).toBeCloseTo(0, 3);
    expect(angularSepDeg(0, 0, 0, 90)).toBeCloseTo(90, 3);
  });
});
