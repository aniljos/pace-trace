# PaceTrace

Replay a run on a map and see how it unfolded. Load a GPX, TCX or FIT file (from Garmin, Samsung Health, Strava exports and others) and PaceTrace animates the route at the runner's real pace, then analyses it.

**Live app:** https://aniljos.github.io/pace-trace/

## What it does

- Animated replay on an OpenStreetMap map, with the route coloured by pace or heart-rate zone, milestone badges, and a static or follow camera
- Compare several runs side by side
- Splits and fade (moving and elapsed pace), heart-rate zones, heart-rate drift (overall and per km), and interval detection
- Weather and air quality for each run (from [Open-Meteo](https://open-meteo.com/))
- Export a video (MP4/WebM) or a PDF/image report with a plain-English summary and explanations, and share it on WhatsApp

## Privacy

Everything runs in your browser. Your run files are never uploaded. The optional weather lookup sends only each run's approximate start location (rounded to about 1 km) and its date to Open-Meteo; you can switch it off with the **Weather** tick-box.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run samples` regenerates the two synthetic sample runs in `samples/`.

## Build and deploy

```bash
npm run build
```

Pushing to `main` builds and publishes the site to GitHub Pages through `.github/workflows/deploy.yml`. In the repository, set **Settings → Pages → Source** to **GitHub Actions** once.

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Weather and air quality by [Open-Meteo](https://open-meteo.com/) (modelled values, not measurements from your route). Built with React, Vite, Leaflet, pdf-lib and the Inter typeface.
