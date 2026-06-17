import type { Config, Theme } from "@shared/index.js";

interface Props {
  config: Config;
  patch: (p: Partial<Config>) => void;
  reset: () => void;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="set-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="set-row">
      <span className="set-label">{label}</span>
      <span className="set-control">{children}</span>
    </label>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? "on" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function Num({
  value,
  step,
  onChange,
}: {
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      step={step ?? 1}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

const THEMES: Theme[] = ["ambient", "telemetry", "focus"];

export function Settings({ config, patch, reset, onClose }: Props) {
  const f = config.showFields;
  const t = config.orientationTrim;
  const setField = (k: keyof Config["showFields"], v: boolean) =>
    patch({ showFields: { ...f, [k]: v } });
  const setTrim = (k: keyof Config["orientationTrim"], v: number) =>
    patch({ orientationTrim: { ...t, [k]: v } });

  return (
    <div className="settings">
      <header className="set-header">
        <h2>Sky AR · settings</h2>
        <button className="set-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="set-body">
        <Section title="Location">
          <Row label="Latitude">
            <Num value={config.centerLat} step={0.0001} onChange={(v) => patch({ centerLat: v })} />
          </Row>
          <Row label="Longitude">
            <Num value={config.centerLon} step={0.0001} onChange={(v) => patch({ centerLon: v })} />
          </Row>
          <Row label={`Range · ${config.radiusMiles} mi`}>
            <Slider value={config.radiusMiles} min={1} max={60} step={1} onChange={(v) => patch({ radiusMiles: v })} />
          </Row>
        </Section>

        <Section title="Camera & orientation">
          <Row label={`Field of view · ${config.fovDeg}°`}>
            <Slider value={config.fovDeg} min={35} max={90} step={1} onChange={(v) => patch({ fovDeg: v })} />
          </Row>
          <Row label={`Yaw trim · ${t.yawDeg}°`}>
            <Slider value={t.yawDeg} min={-180} max={180} step={1} onChange={(v) => setTrim("yawDeg", v)} />
          </Row>
          <Row label={`Pitch trim · ${t.pitchDeg}°`}>
            <Slider value={t.pitchDeg} min={-90} max={90} step={1} onChange={(v) => setTrim("pitchDeg", v)} />
          </Row>
          <Row label={`Roll trim · ${t.rollDeg}°`}>
            <Slider value={t.rollDeg} min={-180} max={180} step={1} onChange={(v) => setTrim("rollDeg", v)} />
          </Row>
          <p className="set-hint">
            Aim at the sun or moon and nudge yaw/pitch/roll until the marker lines up. Device compasses
            are off by a few degrees.
          </p>
        </Section>

        <Section title="Sky layer">
          <Row label="Sun">
            <Toggle checked={config.showSun} onChange={(v) => patch({ showSun: v })} />
          </Row>
          <Row label="Moon">
            <Toggle checked={config.showMoon} onChange={(v) => patch({ showMoon: v })} />
          </Row>
          <Row label="Stars">
            <Toggle checked={config.showStars} onChange={(v) => patch({ showStars: v })} />
          </Row>
          <Row label="Planets">
            <Toggle checked={config.showPlanets} onChange={(v) => patch({ showPlanets: v })} />
          </Row>
          <Row label="Satellites / ISS">
            <Toggle checked={config.showSatellites} onChange={(v) => patch({ showSatellites: v })} />
          </Row>
          <Row label={`Star magnitude limit · ${config.starMagLimit}`}>
            <Slider value={config.starMagLimit} min={1} max={4.5} step={0.1} onChange={(v) => patch({ starMagLimit: v })} />
          </Row>
        </Section>

        <Section title="Aircraft & labels">
          <Row label={`Poll interval · ${(config.pollMs / 1000).toFixed(0)}s`}>
            <Slider value={config.pollMs} min={3000} max={15000} step={1000} onChange={(v) => patch({ pollMs: v })} />
          </Row>
          <Row label={`Min altitude · ${config.minAltitudeFt} ft`}>
            <Slider value={config.minAltitudeFt} min={0} max={20000} step={500} onChange={(v) => patch({ minAltitudeFt: v })} />
          </Row>
          <Row label="Callsign">
            <Toggle checked={f.flight} onChange={(v) => setField("flight", v)} />
          </Row>
          <Row label="Airline">
            <Toggle checked={f.airline} onChange={(v) => setField("airline", v)} />
          </Row>
          <Row label="Type">
            <Toggle checked={f.type} onChange={(v) => setField("type", v)} />
          </Row>
          <Row label="Altitude">
            <Toggle checked={f.altitude} onChange={(v) => setField("altitude", v)} />
          </Row>
          <Row label="Speed">
            <Toggle checked={f.speed} onChange={(v) => setField("speed", v)} />
          </Row>
          <Row label="Destination">
            <Toggle checked={f.destination} onChange={(v) => setField("destination", v)} />
          </Row>
          <Row label={`Label count · ${config.labelDensity === "all" ? "all" : config.nearestN}`}>
            <select value={config.labelDensity} onChange={(e) => patch({ labelDensity: e.target.value as Config["labelDensity"] })}>
              <option value="nearestOnly">Nearest only</option>
              <option value="nearestN">Nearest N</option>
              <option value="all">All</option>
            </select>
          </Row>
        </Section>

        <Section title="Look">
          <Row label="Theme">
            <select value={config.theme} onChange={(e) => patch({ theme: e.target.value as Theme })}>
              {THEMES.map((th) => (
                <option key={th} value={th}>
                  {th}
                </option>
              ))}
            </select>
          </Row>
          <Row label={`Glyph size · ${config.glyphSizePx}`}>
            <Slider value={config.glyphSizePx} min={12} max={48} step={1} onChange={(v) => patch({ glyphSizePx: v })} />
          </Row>
          <Row label={`Brightness · ${(config.brightness * 100).toFixed(0)}%`}>
            <Slider value={config.brightness} min={0.2} max={1} step={0.05} onChange={(v) => patch({ brightness: v })} />
          </Row>
          <Row label={`Trail · ${config.trailSeconds}s`}>
            <Slider value={config.trailSeconds} min={0} max={120} step={5} onChange={(v) => patch({ trailSeconds: v })} />
          </Row>
          <Row label="Color by altitude">
            <Toggle checked={config.altitudeColor} onChange={(v) => patch({ altitudeColor: v })} />
          </Row>
          <Row label="Reticle + compass">
            <Toggle checked={config.showReticle && config.showCompass} onChange={(v) => patch({ showReticle: v, showCompass: v })} />
          </Row>
        </Section>

        <button className="set-reset" onClick={reset}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
