// Vercel serverless function — proxy + normalize the airplanes.live point API
// for the AR client. Same-origin (no CORS), quantizes the query so nearby users
// share the edge cache, and normalizes the readsb JSON into our Aircraft shape.
//
// Deployed at GET /api/aircraft?lat=..&lon=..&r=..  (r in statute miles)

type ResBody = { now: number; aircraft: NormalizedAircraft[] };

// Minimal Aircraft shape — mirrors shared/src/aircraft.ts (kept inline so the
// function bundles without resolving the pnpm workspace package).
interface NormalizedAircraft {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  altBaro?: number | null;
  altGeom?: number | null;
  gs?: number;
  track?: number;
  baroRate?: number | null;
  squawk?: string;
  category?: string;
  onGround?: boolean;
  registration?: string;
  typeCode?: string;
  seen?: number;
  rssi?: number;
  ts?: number;
}

interface RawAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  squawk?: string;
  category?: string;
  r?: string;
  t?: string;
  seen?: number;
  rssi?: number;
}

const NM_PER_MILE = 0.868976;
const DEFAULT_URL =
  "https://api.airplanes.live/v2/point/{lat}/{lon}/{r}";

/** Round to ~0.01° (≈ 1.1 km) so requests from the same neighbourhood cache-hit. */
function quantize(value: number, step = 0.01): number {
  return Math.round(value / step) * step;
}

function normalize(raw: RawAircraft, ts: number): NormalizedAircraft | null {
  if (!raw.hex) return null;
  const onGround = raw.alt_baro === "ground";
  return {
    hex: raw.hex,
    flight: raw.flight?.trim() || undefined,
    lat: raw.lat,
    lon: raw.lon,
    altBaro: onGround ? null : (raw.alt_baro as number | undefined) ?? null,
    altGeom: raw.alt_geom ?? null,
    gs: raw.gs,
    track: raw.track,
    baroRate: raw.baro_rate ?? null,
    squawk: raw.squawk,
    category: raw.category,
    onGround,
    registration: raw.r,
    typeCode: raw.t,
    seen: raw.seen,
    rssi: raw.rssi,
    ts,
  };
}

export default async function handler(
  req: { method?: string; query: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void; end: () => void };
    setHeader: (name: string, value: string) => void;
  },
): Promise<void> {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const rMi = Number(req.query.r ?? 8);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: "lat and lon query params required" });
    return;
  }

  const qLat = quantize(lat);
  const qLon = quantize(lon);
  const rNm = Math.min(250, Math.max(1, Math.ceil(Math.min(60, rMi) * NM_PER_MILE) + 1));

  const template = process.env.AIRPLANES_LIVE_API ?? DEFAULT_URL;
  const url = template
    .replace("{lat}", qLat.toFixed(4))
    .replace("{lon}", qLon.toFixed(4))
    .replace("{r}", String(rNm));

  const now = Date.now();
  // Short shared cache: positions move fast, but two phones a block apart hit
  // the same quantized cell within the same couple of seconds.
  res.setHeader("Cache-Control", "public, s-maxage=2, stale-while-revalidate=8");

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6000);
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (response.status === 429) {
      res.status(429).json({ now, aircraft: [] });
      return;
    }
    if (!response.ok) {
      res.status(502).json({ now, aircraft: [], error: `upstream HTTP ${response.status}` });
      return;
    }
    const json = (await response.json()) as { aircraft?: RawAircraft[]; ac?: RawAircraft[] };
    const rawList: RawAircraft[] = json.aircraft ?? json.ac ?? [];
    const aircraft: NormalizedAircraft[] = [];
    for (const raw of rawList) {
      const ac = normalize(raw, now);
      if (ac) aircraft.push(ac);
    }
    const body: ResBody = { now, aircraft };
    res.status(200).json(body);
  } catch (err) {
    res.status(200).json({ now, aircraft: [], error: err instanceof Error ? err.message : "fetch failed" });
  }
}
