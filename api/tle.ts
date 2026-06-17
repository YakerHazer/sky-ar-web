// Vercel serverless function — proxy the Celestrak visual-satellite TLE feed
// and cache it aggressively at the edge. The client computes ISS / satellite
// positions from these with satellite.js; TLEs drift slowly so a 6-hour
// s-maxage keeps Celestrak off our back.
//
// Deployed at GET /api/tle  →  [{ name, line1, line2 }, ...]

interface Tle {
  name: string;
  line1: string;
  line2: string;
}

const DEFAULT_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle";

function parseTle(text: string): Tle[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length);
  const out: Tle[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith("1 ") && lines[i + 1]?.startsWith("2 ")) {
      const name = (lines[i - 1] ?? "SAT").replace(/^0 /, "").trim();
      out.push({ name, line1: lines[i], line2: lines[i + 1] });
      i++;
    }
  }
  return out;
}

export default async function handler(
  _req: unknown,
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (name: string, value: string) => void;
  },
): Promise<void> {
  // Cache for 6h at the edge; allow serving stale for up to a day.
  res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");

  const url = process.env.TLE_URL ?? DEFAULT_URL;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12000);
    const response = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      res.status(502).json([]);
      return;
    }
    const tles = parseTle(await response.text());
    res.status(200).json(tles);
  } catch {
    res.status(200).json([]);
  }
}
