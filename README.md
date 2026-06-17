# Sky AR

Point your phone at the sky and see the aircraft flying overhead — plus the
**sun, moon, bright stars, naked-eye planets (Venus, Jupiter, Mars, Saturn,
Mercury), and the ISS** — pinned to where they actually are, live, through your
camera.

This is a **web port** of [cpaczek/skylight](https://github.com/cpaczek/skylight),
which was a ceiling-projector appliance (RTL-SDR + Raspberry Pi). The appliance
parts — the PTZ roof-camera tracker, the Twitch stream, the Pi kiosk, the radio
source — are gone. What remains is the pure sky engine, retargeted at a
**mobile-web AR** experience that deploys to **Vercel** with zero hardware.

![Sky AR](docs/skylight.png)

## What it does

- Opens the **back camera** and overlays a transparent canvas on top.
- Reads **device orientation** (compass + tilt + roll) so the overlay tracks the
  camera as you pan — a planet or plane stays glued to the real sky.
- Pulls **live ADS-B aircraft** around your location (from the free
  airplanes.live API) and renders them as luminous, type-aware glyphs —
  widebodies, turboprops with spinning props, helicopters with spinning rotors —
  at their true azimuth/elevation, with comet trails and labels.
- Computes the **real sky** behind them (sun, moon with phase, stars +
  asterisms, planets, ISS/satellites from TLEs) for your location and time.
- Everything (location, FOV, orientation trim, sky toggles, labels, theme) is
  tunable from an in-app settings drawer and saved on the device.

## Try it

Runs entirely in the browser against public APIs — no radio, no server to run.

```sh
pnpm install
pnpm dev          # http://localhost:5173  (frontend only)
```

For the full experience locally **including the `/api` functions**, use Vercel's
dev server (it serves both the Vite app and the serverless routes):

```sh
pnpm install
npx vercel dev    # http://localhost:3000
```

> Camera, motion, and geolocation all require **HTTPS** and a **user gesture**.
> Open the deployed URL on your phone (not localhost) for the real thing.

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, **New Project → import the repo**. Defaults are already wired up
   via [`vercel.json`](vercel.json):
   - **Install:** `pnpm install`
   - **Build:** `pnpm -F web build`
   - **Output:** `web/dist`
   - **Functions:** `api/*.ts` (auto-detected)
3. Deploy. Open the production URL on your phone, tap **Start AR**, and allow
   camera + motion + location.

No environment variables are required. Optional overrides:

| Env | Default | Meaning |
| --- | --- | --- |
| `AIRPLANES_LIVE_API` | `https://api.airplanes.live/v2/point/{lat}/{lon}/{r}` | Aircraft feed (template). |
| `TLE_URL` | Celestrak visual-satellite group | Satellite elements for ISS/Starlink etc. |

## How it works

```
phone camera ──getUserMedia──> <video> (full-bleed background)
deviceorientation ───────────> camera view (az/alt + roll, with manual trim)
                                     │
airplanes.live ──/api/aircraft──> normalize ──> aircraft (az,alt)
Celestrak TLEs ──/api/tle──────> satellite.js ──> ISS/sats (az,alt)
astronomy-engine ─────────────> sun/moon/stars/planets (az,alt)
                                     │
                  AR tangent-plane projection (az/alt → screen px)
                                     │
                          transparent <canvas> overlay
```

### Layout

- **`shared/`** — the pure engine (no DOM): geo math, the celestial/sky
  computer, the bright-star catalog, and the AR projection math
  (`azAltToEnu`, `makeCameraView`, `projectAzAlt`, `applyOrientationTrim`).
  Unit-tested.
- **`web/`** — Vite + React single-page app (`web/src/app/`): camera +
  orientation + polling hooks, the AR canvas renderer, the settings drawer.
- **`api/`** — Vercel serverless functions: `aircraft` (proxies + normalizes
  airplanes.live, quantized for edge caching) and `tle` (proxies Celestrak,
  cached 6 h).

### Device orientation → camera view

`useOrientation` builds the W3C device→world (East-North-Up) rotation matrix
from `deviceorientation` (preferring iOS `webkitCompassHeading`), takes the back
camera boresight as `−device-Z`, and uses the device's screen axes as the image
basis — so physical roll is captured for free. Device compasses and true-vs-
magnetic north drift by a few degrees, so the settings drawer exposes
**yaw / pitch / roll trim**: aim at the sun or moon and nudge until the marker
lines up. (Browser orientation is genuinely device-dependent; the trim is the
pragmatic, no-code fix.)

## Scripts

```sh
pnpm dev        # vite dev server (frontend)
pnpm build      # production build → web/dist
pnpm test       # vitest
pnpm typecheck  # shared + web
```

## Stack

TypeScript · React · Vite · pnpm workspaces · astronomy-engine · satellite.js ·
Vercel serverless functions.

## Credits

Sky engine adapted from [cpaczek/skylight](https://github.com/cpaczek/skylight)
(MIT). Aircraft data: [airplanes.live](https://airplanes.live). Satellite
elements: [Celestrak](https://celestrak.org).

## License

MIT — be excellent, point it at the sky.
