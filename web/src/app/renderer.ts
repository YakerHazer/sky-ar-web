// AR canvas renderer — overlays live aircraft + the real sky (sun, moon, stars,
// planets, ISS) on top of the back-camera feed.
//
// Motion model: every fix is stamped with its local arrival time and pushed to a
// per-aircraft history. We render the world RENDER_DELAY_MS in the past and
// interpolate between the two surrounding real fixes — buttery smooth from a
// ~5 Hz poll, no teleporting. Interpolation happens in ground (lat/lon+alt)
// space, then each frame we convert to (azimuth, altitude) on the sky and
// project through the phone's live camera view (where it's pointed + how it's
// rolled) to screen pixels. So as you pan the phone, the labels glide and stick
// to the real sky; as planes move, they drift across the field correctly.
//
// Visual language: luminous altitude-graded glyphs, comet trails that taper and
// fade, restrained typography for the nearest few, a center reticle + heading
// tape so you can frame the sky.

import {
  llToMeters,
  deadReckon,
  metersToMiles,
  formatSpeed,
  skyGlyphScale,
  lerpAzimuth,
  groundToSkyAngles,
  EMERGENCY_SQUAWKS,
  computeSky,
  ASTERISMS,
  projectAzAlt,
  type Aircraft,
  type Config,
  type Meters,
  type Point,
  type SkyAngles,
  type CamView,
  type Tle,
  type Sky,
} from "@shared/index.js";
import { classifyGlyph, drawAircraftGlyph, GLYPH_SCALE } from "./aircraftGlyph.js";
import { lookupAirline, lookupType } from "./tables.js";

/** How far in the past we render, ms — just over the poll interval for safety. */
const RENDER_DELAY_MS = 1500;

/** Planets get a characteristic tint, as "r,g,b". */
const PLANET_COLORS: Record<string, string> = {
  Venus: "255,244,214",
  Jupiter: "245,226,184",
  Mars: "232,131,90",
  Saturn: "232,217,160",
  Mercury: "200,192,176",
};

interface Sample {
  t: number; // performance.now() at arrival
  m: Meters;
  altFt: number;
  track?: number;
  gs?: number;
}

interface Track {
  ac: Aircraft;
  history: Sample[];
  firstSeen: number;
  lastSeen: number;
  hasPos: boolean;
  /** Smoothed appearance alpha (fade in on spawn, out when stale). */
  life: number;
}

// Altitude colour ramp — warm low, cool high.
const ALT_STOPS: [number, [number, number, number]][] = [
  [0, [255, 138, 61]],
  [4000, [255, 198, 92]],
  [10000, [120, 224, 196]],
  [20000, [110, 178, 255]],
  [30000, [150, 150, 255]],
  [40000, [232, 236, 255]],
];

function altRamp(alt: number): [number, number, number] {
  if (alt <= ALT_STOPS[0][0]) return ALT_STOPS[0][1];
  for (let i = 1; i < ALT_STOPS.length; i++) {
    if (alt <= ALT_STOPS[i][0]) {
      const [a0, c0] = ALT_STOPS[i - 1];
      const [a1, c1] = ALT_STOPS[i];
      const f = (alt - a0) / (a1 - a0);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return ALT_STOPS[ALT_STOPS.length - 1][1];
}

const rgba = (c: [number, number, number], a: number) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const int = parseInt(n, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Stable per-aircraft phase offset (0..2π) so props/rotors aren't in sync. */
function hexSeed(hex: string): number {
  let n = 0;
  for (let i = 0; i < hex.length; i++) n = (n * 31 + hex.charCodeAt(i)) % 360;
  return (n / 360) * Math.PI * 2;
}

interface Visible {
  tr: Track;
  az: number;
  alt: number;
  slantM: number;
  p: Point;
  heading: number;
  sepDeg: number;
  rangeMi: number;
  alpha: number;
  color: [number, number, number];
  emergency: boolean;
  sizeScale: number;
}

export class ArRenderer {
  private ctx: CanvasRenderingContext2D;
  private tracks = new Map<string, Track>();
  private raf = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private prevFrame = 0;
  private nextFrameDue = 0;
  private frameT = 0;

  private sky: Sky = { stars: [], sats: [], planets: [] };
  private skyComputedAt = 0;
  private skyOffsetUsed = NaN;
  private sourceDownAt: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private getConfig: () => Config,
    private getView: () => CamView | null,
    private getTles: () => Tle[],
  ) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  start(): void {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const fps = this.getConfig().maxFps;
      if (fps > 0) {
        const interval = 1000 / fps;
        if (this.nextFrameDue === 0) this.nextFrameDue = now;
        if (now < this.nextFrameDue) return;
        this.nextFrameDue += interval;
        if (now - this.nextFrameDue > interval) this.nextFrameDue = now + interval;
      } else {
        this.nextFrameDue = 0;
      }
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setSourceOk(ok: boolean): void {
    if (ok) this.sourceDownAt = null;
    else this.sourceDownAt ??= performance.now();
  }

  /** Feed a fresh snapshot. Stamps each fix with local arrival time + enriches. */
  update(aircraft: Aircraft[]): void {
    const cfg = this.getConfig();
    const now = performance.now();
    for (const ac of aircraft) {
      if (!this.passesFilter(ac, cfg)) continue;
      // Client-side enrichment for anything the proxy didn't fill.
      ac.typeName = ac.typeName ?? lookupType(ac.typeCode);
      ac.airline = ac.airline ?? lookupAirline(ac.flight);
      const hasPos = ac.lat != null && ac.lon != null;
      const m = hasPos
        ? llToMeters(ac.lat!, ac.lon!, cfg.centerLat, cfg.centerLon)
        : { east: 0, north: 0 };
      const altFt = ac.altBaro ?? ac.altGeom ?? 0;
      let tr = this.tracks.get(ac.hex);
      if (!tr) {
        tr = { ac, history: [], firstSeen: now, lastSeen: now, hasPos, life: 0 };
        this.tracks.set(ac.hex, tr);
      }
      tr.ac = ac;
      tr.lastSeen = now;
      tr.hasPos = hasPos;
      if (hasPos) {
        const last = tr.history[tr.history.length - 1];
        if (
          !last ||
          last.m.east !== m.east ||
          last.m.north !== m.north ||
          last.altFt !== altFt
        ) {
          tr.history.push({ t: now, m, altFt, track: ac.track, gs: ac.gs });
        }
      }
    }
  }

  private passesFilter(ac: Aircraft, cfg: Config): boolean {
    if (cfg.hideOnGround && ac.onGround) return false;
    const alt = ac.altBaro ?? ac.altGeom;
    if (alt != null) {
      if (alt < cfg.minAltitudeFt) return false;
      if (alt > cfg.maxAltitudeFt) return false;
    }
    return true;
  }

  /** Interpolate a track's ground fix (+ altitude) at render time `tt`. */
  private sampleAt(tr: Track, tt: number, cfg: Config) {
    const h = tr.history;
    if (h.length === 0) return null;
    if (tt <= h[0].t) return { m: h[0].m, altFt: h[0].altFt };
    const lastS = h[h.length - 1];
    if (tt >= lastS.t) {
      const dt = Math.min((tt - lastS.t) / 1000, cfg.maxExtrapolationSec);
      const m = cfg.interpolate
        ? deadReckon(lastS.m, lastS.track, lastS.gs, dt)
        : lastS.m;
      const vr = tr.ac.baroRate ?? 0;
      const altFt = lastS.altFt + (vr / 60) * dt;
      return { m, altFt };
    }
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= tt && tt <= h[i].t) {
        const a = h[i - 1];
        const b = h[i];
        const f = (tt - a.t) / Math.max(1, b.t - a.t);
        return {
          m: {
            east: a.m.east + (b.m.east - a.m.east) * f,
            north: a.m.north + (b.m.north - a.m.north) * f,
          },
          altFt: a.altFt + (b.altFt - a.altFt) * f,
        };
      }
    }
    return { m: lastS.m, altFt: lastS.altFt };
  }

  private fallbackAz(tr: Track): number | undefined {
    return tr.ac.track ?? tr.history[tr.history.length - 1]?.track;
  }

  /** Sky position (az°, alt°, slant) of a track at render time `tt`. */
  private skyAt(tr: Track, tt: number, cfg: Config): SkyAngles | null {
    const s = this.sampleAt(tr, tt, cfg);
    if (!s) return null;
    return groundToSkyAngles(s.m, s.altFt, this.fallbackAz(tr));
  }

  /** Screen point for a sky (az,alt) through the live view, or null if off-frame. */
  private project(az: number, alt: number, cfg: Config, view: CamView): Point | null {
    const r = projectAzAlt(az, alt, view, { w: this.w, h: this.h, fovHdeg: cfg.fovDeg });
    if (!r.inFront || r.x == null || r.y == null) return null;
    const margin = 60;
    if (r.x < -margin || r.x > this.w + margin || r.y < -margin || r.y > this.h + margin) {
      return null;
    }
    return { x: r.x, y: r.y };
  }

  private updateSky(cfg: Config, now: number): void {
    const want =
      cfg.showStars || cfg.showSun || cfg.showMoon || cfg.showSatellites || cfg.showPlanets;
    if (!want) {
      this.sky = { stars: [], sats: [], planets: [] };
      return;
    }
    if (now - this.skyComputedAt < 300 && this.skyOffsetUsed === cfg.skyTimeOffsetMin) return;
    this.skyComputedAt = now;
    this.skyOffsetUsed = cfg.skyTimeOffsetMin;
    const date = new Date(Date.now() + cfg.skyTimeOffsetMin * 60000);
    this.sky = computeSky(date, cfg.centerLat, cfg.centerLon, {
      sun: cfg.showSun,
      moon: cfg.showMoon,
      stars: cfg.showStars,
      satellites: cfg.showSatellites,
      planets: cfg.showPlanets,
      magLimit: cfg.starMagLimit,
      tles: this.getTles(),
    });
  }

  private draw(): void {
    const cfg = this.getConfig();
    const view = this.getView();
    const ctx = this.ctx;
    const now = performance.now();
    const frameDt = this.prevFrame ? (now - this.prevFrame) / 1000 : 0.016;
    this.prevFrame = now;
    this.frameT = now / 1000;

    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h) {
      this.resize();
    }

    // Transparent clear so the camera feed shows through.
    ctx.clearRect(0, 0, this.w, this.h);

    if (!view) {
      // No orientation yet — just the reticle prompt.
      return;
    }

    this.updateSky(cfg, now);
    this.drawSky(cfg, view);
    if (cfg.showReticle) this.drawReticle(cfg, view);
    if (cfg.showCompass) this.drawHeadingTape(cfg, view);

    const tt = now - RENDER_DELAY_MS;
    const visible: Visible[] = [];

    for (const [hex, tr] of this.tracks) {
      let stale = (now - tr.lastSeen) / 1000;
      if (this.sourceDownAt !== null) {
        const downFor = (now - this.sourceDownAt) / 1000;
        stale = Math.max(0, stale - downFor);
        if ((now - tr.lastSeen) / 1000 > Math.max(cfg.staleSec, 90)) {
          this.tracks.delete(hex);
          continue;
        }
      }
      if (stale > cfg.staleSec) {
        this.tracks.delete(hex);
        continue;
      }
      const keep = Math.max(cfg.trailSeconds, 6) * 1000 + 4000;
      while (tr.history.length > 2 && now - tr.history[0].t > keep) tr.history.shift();

      const target = stale > cfg.staleSec * 0.5 ? 0 : 1;
      tr.life += (target - tr.life) * Math.min(1, frameDt * 3.5);

      if (!tr.hasPos) continue;
      const sky = this.skyAt(tr, tt, cfg);
      if (!sky) continue;

      const rangeMi = metersToMiles(sky.groundM);
      if (rangeMi > cfg.radiusMiles * 1.08) continue;
      if (sky.elev < 0) continue; // below the horizon — not visible through the camera

      const p = this.project(sky.az, sky.elev, cfg, view);
      if (!p) continue;

      const heading = this.screenHeading(tr, tt, cfg, view, sky);
      const sep = projectAzAlt(sky.az, sky.elev, view, { w: this.w, h: this.h, fovHdeg: cfg.fovDeg });
      const edgeFade = clamp01((cfg.radiusMiles - rangeMi) / (cfg.radiusMiles * 0.14));
      const alpha = clamp01(edgeFade) * tr.life * cfg.brightness;
      const alt = sky.slantM > 0 ? tr.ac.altBaro ?? tr.ac.altGeom ?? 0 : 0;
      const color = cfg.altitudeColor ? altRamp(alt) : hexToRgb(cfg.palette.glyph);
      const emergency =
        cfg.highlightEmergency && !!tr.ac.squawk && EMERGENCY_SQUAWKS.has(tr.ac.squawk);
      const sizeScale = skyGlyphScale(sky.slantM);

      visible.push({
        tr,
        az: sky.az,
        alt: sky.elev,
        slantM: sky.slantM,
        p,
        heading,
        sepDeg: sep.sepDeg,
        rangeMi,
        alpha,
        color,
        emergency,
        sizeScale,
      });
    }

    // Nearest (lowest separation) paints on top.
    visible.sort((a, b) => b.sepDeg - a.sepDeg);
    for (const v of visible) this.drawTrail(cfg, view, v, tt);
    for (const v of visible) this.drawGlyph(cfg, v);

    const byNear = [...visible].sort((a, b) => a.sepDeg - b.sepDeg);
    this.drawLabels(cfg, byNear);
  }

  /** Heading of the aircraft on screen (radians), from panning two samples. */
  private screenHeading(tr: Track, tt: number, cfg: Config, view: CamView, sky: SkyAngles): number {
    const a = this.skyAt(tr, tt - 400, cfg);
    const b = this.skyAt(tr, tt + 400, cfg);
    if (a && b) {
      const pa = this.project(a.az, a.elev, cfg, view);
      const pb = this.project(b.az, b.elev, cfg, view);
      if (pa && pb && Math.hypot(pb.x - pa.x, pb.y - pa.y) > 0.5) {
        return Math.atan2(pb.y - pa.y, pb.x - pa.x);
      }
    }
    // Fall back to the track bearing projected: nudge the az slightly.
    const track = tr.ac.track ?? 0;
    const pa = this.project(sky.az, sky.elev, cfg, view);
    const aheadAz = lerpAzimuth(sky.az, track, 0.02);
    const pb = this.project(aheadAz, sky.elev, cfg, view);
    if (pa && pb) return Math.atan2(pb.y - pa.y, pb.x - pa.x);
    return 0;
  }

  private drawReticle(cfg: Config, view: CamView): void {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const col = hexToRgb(cfg.palette.grid);
    ctx.save();
    ctx.strokeStyle = rgba(col, 0.5 * cfg.brightness);
    ctx.lineWidth = 1;
    // Center cross + ring (the boresight — where the camera is aimed).
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.moveTo(cx - 12, cy);
    ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5);
    ctx.lineTo(cx, cy + 12);
    ctx.stroke();
    // Boresight readout.
    ctx.font = `300 10px ${cfg.fonts.mono}`;
    ctx.fillStyle = rgba(hexToRgb(cfg.palette.text), 0.6 * cfg.brightness);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      `${Math.round(view.az)}° / ${Math.round(view.alt)}°`,
      cx,
      cy + 14,
    );
    ctx.restore();
  }

  private drawHeadingTape(cfg: Config, view: CamView): void {
    const ctx = this.ctx;
    const y = 26;
    const cx = this.w / 2;
    const pxPerDeg = this.w / cfg.fovDeg;
    const col = hexToRgb(cfg.palette.text);
    ctx.save();
    ctx.font = `300 11px ${cfg.fonts.label}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let az = 0; az < 360; az += 15) {
      let d = az - view.az;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      const x = cx + d * pxPerDeg;
      if (x < 10 || x > this.w - 10) continue;
      const major = az % 90 === 0;
      const label: string | null =
        az === 0 ? "N" : az === 90 ? "E" : az === 180 ? "S" : az === 270 ? "W" : major ? `${az}` : null;
      ctx.strokeStyle = rgba(col, 0.25 * cfg.brightness);
      ctx.beginPath();
      ctx.moveTo(x, y - (major ? 6 : 3));
      ctx.lineTo(x, y + (major ? 6 : 3));
      ctx.stroke();
      if (label) {
        ctx.fillStyle = rgba(col, (az === 0 ? 0.95 : 0.5) * cfg.brightness);
        ctx.fillText(label, x, y + 18);
      }
    }
    ctx.restore();
  }

  private drawSky(cfg: Config, view: CamView): void {
    const ctx = this.ctx;
    const b = cfg.brightness;

    // Asterism lines (faint).
    if (cfg.showStars && this.sky.stars.length) {
      const pts = new Map<string, Point>();
      for (const s of this.sky.stars) {
        if (s.id) {
          const p = this.project(s.az, s.alt, cfg, view);
          if (p) pts.set(s.id, p);
        }
      }
      ctx.save();
      ctx.strokeStyle = `rgba(150,170,220,${0.16 * b})`;
      ctx.lineWidth = 1;
      for (const [a, c] of ASTERISMS) {
        const pa = pts.get(a);
        const pc = pts.get(c);
        if (pa && pc) {
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pc.x, pc.y);
          ctx.stroke();
        }
      }
      ctx.restore();

      for (const s of this.sky.stars) {
        const p = s.id ? pts.get(s.id) : undefined;
        if (!p) continue;
        const mag = s.mag ?? 2;
        const size = Math.max(0.6, 2.6 - mag * 0.7);
        const tw = 0.78 + 0.22 * Math.sin(this.frameT * 3 + s.az);
        const a = clamp01((2.8 - mag) / 3) * b * tw;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(214,224,255,${a})`;
        if (mag < 0.6) {
          ctx.shadowColor = `rgba(200,215,255,${a})`;
          ctx.shadowBlur = size * 3;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        if (mag < cfg.starLabelMagLimit && s.name) this.skyLabel(p, s.name, cfg, 0.5 * b);
      }
    }

    if (cfg.showMoon && this.sky.moon && this.sky.moon.alt > -2) {
      const p = this.project(this.sky.moon.az, this.sky.moon.alt, cfg, view);
      if (p) this.drawMoon(p, this.sky.moon.illum ?? 1, this.sky.moon.waning ?? false, b);
    }
    if (cfg.showSun && this.sky.sun && this.sky.sun.alt > -2) {
      const p = this.project(this.sky.sun.az, this.sky.sun.alt, cfg, view);
      if (p) this.drawSun(p, b);
    }
    if (cfg.showPlanets && this.sky.planets.length) {
      for (const pl of this.sky.planets) {
        const p = this.project(pl.az, pl.alt, cfg, view);
        if (!p) continue;
        const mag = pl.mag ?? 1;
        const size = Math.max(1.6, Math.min(4, 3 - mag * 0.5));
        const col = PLANET_COLORS[pl.name ?? ""] ?? "230,224,205";
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col},${0.95 * b})`;
        if (mag < 0.5) {
          ctx.shadowColor = `rgba(${col},${b})`;
          ctx.shadowBlur = size * 2.5;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        if (pl.name) this.skyLabel({ x: p.x + 6, y: p.y - 6 }, pl.name, cfg, 0.75 * b, `rgb(${col})`);
      }
    }
    if (cfg.showSatellites && this.sky.sats.length) {
      for (const sat of this.sky.sats) {
        const p = this.project(sat.az, sat.alt, cfg, view);
        if (!p) continue;
        const iss = sat.kind === "iss";
        ctx.beginPath();
        ctx.arc(p.x, p.y, iss ? 3 : 1.6, 0, Math.PI * 2);
        if (iss) {
          ctx.fillStyle = `rgba(140,255,214,${0.95 * b})`;
          ctx.shadowColor = `rgba(140,255,214,${b})`;
          ctx.shadowBlur = 10;
        } else {
          ctx.fillStyle = `rgba(170,205,255,${0.65 * b})`;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        if (iss) this.skyLabel({ x: p.x + 6, y: p.y - 6 }, "ISS", cfg, 0.9 * b, "#8CFFD6");
        else if (cfg.satelliteLabels && sat.name) this.skyLabel({ x: p.x + 5, y: p.y - 5 }, sat.name, cfg, 0.6 * b);
      }
    }
  }

  private drawSun(p: Point, b: number): void {
    const ctx = this.ctx;
    ctx.save();
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26);
    g.addColorStop(0, `rgba(255,210,120,${0.9 * b})`);
    g.addColorStop(0.4, `rgba(255,180,80,${0.4 * b})`);
    g.addColorStop(1, "rgba(255,170,70,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,224,150,${b})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawMoon(p: Point, illum: number, waning: boolean, b: number): void {
    const ctx = this.ctx;
    const r = 8;
    ctx.save();
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6);
    g.addColorStop(0, `rgba(220,228,245,${0.35 * b})`);
    g.addColorStop(1, "rgba(220,228,245,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(64,72,90,${0.55 * b})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(p.x, p.y);
    ctx.scale(waning ? -1 : 1, 1);
    const rx = r * (1 - 2 * illum);
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(0, 0, Math.abs(rx), r, 0, Math.PI / 2, -Math.PI / 2, rx > 0);
    ctx.closePath();
    ctx.fillStyle = `rgba(232,238,250,${b})`;
    ctx.fill();
    ctx.restore();
  }

  private skyLabel(p: Point, text: string, cfg: Config, alpha: number, color = "#AEB6C6"): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `300 10px ${cfg.fonts.label}`;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    try {
      ctx.letterSpacing = "1px";
    } catch {
      /* noop */
    }
    ctx.fillText(text, p.x + 5, p.y);
    try {
      ctx.letterSpacing = "0px";
    } catch {
      /* noop */
    }
    ctx.restore();
  }

  private drawTrail(cfg: Config, view: CamView, v: Visible, tt: number): void {
    if (cfg.trailSeconds <= 0) return;
    const ctx = this.ctx;
    const h = v.tr.history;
    if (h.length < 2) return;

    const windowMs = cfg.trailSeconds * 1000;
    const pts: { p: Point; age: number }[] = [];
    for (const s of h) {
      if (s.t < tt - windowMs || s.t > tt) continue;
      const sky = groundToSkyAngles(s.m, s.altFt, v.tr.ac.track);
      const p = this.project(sky.az, sky.elev, cfg, view);
      if (!p) continue;
      pts.push({ p, age: (tt - s.t) / windowMs });
    }
    const head = this.project(v.az, v.alt, cfg, view);
    if (head) pts.push({ p: head, age: 0 });
    if (pts.length < 2) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const f = 1 - b.age;
      ctx.strokeStyle = rgba(v.color, 0.55 * f * v.alpha);
      ctx.lineWidth = 0.7 + 2.2 * f * (cfg.glyphSizePx / 14);
      ctx.beginPath();
      ctx.moveTo(a.p.x, a.p.y);
      ctx.lineTo(b.p.x, b.p.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGlyph(cfg: Config, v: Visible): void {
    const ctx = this.ctx;
    const color = v.emergency ? hexToRgb(cfg.palette.warn) : v.color;
    const kind = classifyGlyph(v.tr.ac);
    const s = cfg.glyphSizePx * GLYPH_SCALE[kind] * v.sizeScale;

    ctx.save();
    ctx.translate(v.p.x, v.p.y);
    ctx.rotate(v.heading + Math.PI / 2);

    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.7);
    halo.addColorStop(0, rgba(color, 0.16 * v.alpha));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.7, 0, Math.PI * 2);
    ctx.fill();

    drawAircraftGlyph(ctx, kind, s, color, v.alpha, this.frameT, hexSeed(v.tr.ac.hex));
    ctx.restore();
  }

  private placedBoxes: { x: number; y: number; w: number; h: number }[] = [];

  private drawLabels(cfg: Config, nearestFirst: Visible[]): void {
    const limit =
      cfg.labelDensity === "all"
        ? nearestFirst.length
        : cfg.labelDensity === "nearestN"
          ? cfg.nearestN
          : 1;
    this.placedBoxes = [];
    for (let i = 0; i < Math.min(limit, nearestFirst.length); i++) {
      const prom = 1 - i / Math.max(1, nearestFirst.length);
      this.drawLabel(cfg, nearestFirst[i], 0.7 + 0.3 * prom);
    }
  }

  private measureLabel(cfg: Config, lines: { text: string; kind: "title" | "sub" }[]) {
    const ctx = this.ctx;
    const lh = 16;
    let w = 0;
    for (const ln of lines) {
      ctx.font = ln.kind === "title" ? `500 14px ${cfg.fonts.label}` : `400 11px ${cfg.fonts.label}`;
      try {
        ctx.letterSpacing = ln.kind === "title" ? "1.5px" : "0.5px";
      } catch {
        /* noop */
      }
      w = Math.max(w, ctx.measureText(ln.text).width);
    }
    try {
      ctx.letterSpacing = "0px";
    } catch {
      /* noop */
    }
    return { w: w + 2, lh, h: lines.length * lh };
  }

  private collides(b: { x: number; y: number; w: number; h: number }): boolean {
    const pad = 3;
    for (const p of this.placedBoxes) {
      if (
        b.x - pad < p.x + p.w &&
        b.x + b.w + pad > p.x &&
        b.y - pad < p.y + p.h &&
        b.y + b.h + pad > p.y
      ) {
        return true;
      }
    }
    return false;
  }

  private labelLines(cfg: Config, ac: Aircraft): { text: string; kind: "title" | "sub" }[] {
    const f = cfg.showFields;
    const out: { text: string; kind: "title" | "sub" }[] = [];
    const title = f.flight ? ac.flight ?? ac.hex.toUpperCase() : ac.airline;
    if (title) out.push({ text: title, kind: "title" });

    const sub: string[] = [];
    if (f.airline && ac.airline && title !== ac.airline) sub.push(ac.airline);
    if (f.type && (ac.typeName || ac.typeCode)) sub.push(ac.typeName ?? ac.typeCode!);
    const alt = ac.altBaro ?? ac.altGeom;
    if (f.altitude) {
      if (ac.onGround) sub.push("GND");
      else if (alt != null) sub.push(`${alt.toLocaleString("en-US")} ft`);
    }
    if (f.speed && ac.gs != null) sub.push(formatSpeed(ac.gs, cfg.speedUnit));
    if (sub.length) out.push({ text: sub.join("   "), kind: "sub" });

    if (f.destination && ac.destination) {
      const head = ac.origin ? `${ac.origin} → ${ac.destination}` : `→ ${ac.destination}`;
      out.push({ text: ac.destName ? `${head}   ${ac.destName}` : head, kind: "sub" });
    }
    if (f.registration && ac.registration) out.push({ text: ac.registration, kind: "sub" });
    return out;
  }

  private drawLabel(cfg: Config, v: Visible, strength: number): void {
    const ctx = this.ctx;
    const lines = this.labelLines(cfg, v.tr.ac);
    if (!lines.length) return;
    const a = v.alpha * strength;
    if (a < 0.04) return;

    const { w, lh, h } = this.measureLabel(cfg, lines);
    const gap = cfg.glyphSizePx * 0.7 + 9;
    const onScreen = (b: { x: number; y: number; w: number; h: number }) =>
      b.x >= 6 && b.x + b.w <= this.w - 6 && b.y >= 6 && b.y + b.h <= this.h - 6;

    const candidates = [
      { x: v.p.x + gap, y: v.p.y - gap - h },
      { x: v.p.x + gap, y: v.p.y + gap },
      { x: v.p.x - gap - w, y: v.p.y - gap - h },
      { x: v.p.x - gap - w, y: v.p.y + gap },
    ];
    let box: { x: number; y: number; w: number; h: number } | null = null;
    for (const c of candidates) {
      const b = { x: c.x, y: c.y, w, h };
      if (onScreen(b) && !this.collides(b)) {
        box = b;
        break;
      }
    }
    if (!box) {
      let b = { x: v.p.x + gap, y: v.p.y - gap - h, w, h };
      for (let k = 0; k < 9 && (this.collides(b) || !onScreen(b)); k++) {
        b = { ...b, y: b.y + lh + 2 };
      }
      box = b;
    }
    box.x = Math.max(6, Math.min(box.x, this.w - 6 - w));
    box.y = Math.max(6, Math.min(box.y, this.h - 6 - h));
    this.placedBoxes.push(box);

    const anchorX = box.x + w / 2 < v.p.x ? box.x + w : box.x;
    const anchorY = Math.max(box.y, Math.min(v.p.y, box.y + h));

    ctx.save();
    // Leader line.
    ctx.strokeStyle = rgba(hexToRgb(cfg.palette.text), 0.24 * a);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(v.p.x, v.p.y);
    ctx.lineTo(anchorX, anchorY);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 6;
    let y = box.y;
    for (const ln of lines) {
      if (ln.kind === "title") {
        ctx.font = `500 14px ${cfg.fonts.label}`;
        ctx.fillStyle = rgba([245, 247, 255], a);
        try {
          ctx.letterSpacing = "1.5px";
        } catch {
          /* noop */
        }
      } else {
        ctx.font = `400 11px ${cfg.fonts.label}`;
        ctx.fillStyle = rgba(hexToRgb(cfg.palette.text), 0.82 * a);
        try {
          ctx.letterSpacing = "0.5px";
        } catch {
          /* noop */
        }
      }
      ctx.fillText(ln.text, box.x, y);
      y += lh;
    }
    try {
      ctx.letterSpacing = "0px";
    } catch {
      /* noop */
    }
    ctx.restore();
  }
}
