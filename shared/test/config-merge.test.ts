// Config deep-merge: partial patches must never drop sibling keys.

import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, mergeConfig } from "../src/config.js";

describe("mergeConfig nested objects", () => {
  it("deep-merges a partial palette (keeps untouched keys)", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { palette: { glyph: "#FFFFFF" } });
    expect(merged.palette.glyph).toBe("#FFFFFF");
    expect(merged.palette.bg).toBe(DEFAULT_CONFIG.palette.bg);
    expect(merged.palette.grid).toBe(DEFAULT_CONFIG.palette.grid);
  });

  it("deep-merges a partial showFields patch", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { showFields: { speed: false } });
    expect(merged.showFields.speed).toBe(false);
    expect(merged.showFields.flight).toBe(DEFAULT_CONFIG.showFields.flight);
  });

  it("deep-merges a partial orientationTrim patch", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { orientationTrim: { yawDeg: 7 } });
    expect(merged.orientationTrim.yawDeg).toBe(7);
    expect(merged.orientationTrim.rollDeg).toBe(DEFAULT_CONFIG.orientationTrim.rollDeg);
  });
});

describe("mergeConfig locationProfiles", () => {
  const profile = { id: "a1", name: "LAX", lat: 33.94, lon: -118.4, radiusMiles: 5 };

  it("persists saved profiles and replaces the array wholesale on patch", () => {
    const withOne = mergeConfig(DEFAULT_CONFIG, { locationProfiles: [profile] });
    expect(withOne.locationProfiles).toEqual([profile]);
    const cleared = mergeConfig(withOne, { locationProfiles: [] });
    expect(cleared.locationProfiles).toEqual([]);
  });

  it("keeps saved profiles when an unrelated field is patched", () => {
    const base = mergeConfig(DEFAULT_CONFIG, { locationProfiles: [profile] });
    const after = mergeConfig(base, { brightness: 0.5 });
    expect(after.locationProfiles).toEqual([profile]);
  });
});
