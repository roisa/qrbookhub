# QRBookHub

Bulk QR code generator. Paste a list of links (one per line or comma-separated, with optional custom names), import a CSV / drag-and-drop a text file, generate styled QR codes in a responsive grid, and download them all as a ZIP. Runs entirely in the browser — no server, no upload.

**Live:** https://roisa.github.io/qrbookhub/

## Features

- Paste URLs (newline / comma separated) or `Name | URL`, `Name, URL`, `Name<TAB>URL`
- CSV import with header detection (`name`/`title`/`label`/`book` × `url`/`link`/`href`)
- Drag-and-drop `.csv`, `.tsv`, `.txt` anywhere on the page
- Editable name on each QR card; drives the ZIP filename
- Search/filter results by name or URL
- Light / dark theme toggle with system default
- Async chunked rendering tuned for 500+ codes (idle-deadline scheduling, `IntersectionObserver` lazy renders, `content-visibility: auto`)
- Per-QR PNG / SVG download, copy URL, and bulk ZIP with `manifest.tsv`
- `Ctrl/Cmd + Enter` to generate

## Tech

- [Vite](https://vitejs.dev/) + vanilla JavaScript (no framework)
- [qr-code-styling](https://github.com/kozakdenys/qr-code-styling) for QR rendering
- [JSZip](https://stuk.github.io/jszip/) + [FileSaver.js](https://github.com/eligrey/FileSaver.js) for bulk download

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
```

## Production build

```bash
npm run build    # outputs static dist/
npm run preview  # serves dist/ at http://localhost:4173/qrbookhub/
```

The `vite.config.js` switches `base` to `/qrbookhub/` for `build`, so the
output is ready for `https://roisa.github.io/qrbookhub/`. For local dev
`base` stays at `/` so `npm run dev` works normally.

Bundle: ~163 KB JS / ~52 KB gzipped, single chunk, no source maps.

## Deploy to GitHub Pages

### Option A — GitHub Actions (recommended)

`.github/workflows/deploy.yml` already builds on every push to `main`
and publishes to GitHub Pages.

1. Push the repo to `https://github.com/roisa/qrbookhub`.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually under the **Actions** tab).
4. Site goes live at https://roisa.github.io/qrbookhub/.

### Option B — Manual `gh-pages` branch

If you'd rather push the built `dist/` directly:

```bash
npm run build
git checkout --orphan gh-pages
git --work-tree=dist add --all
git --work-tree=dist commit -m "Deploy"
git push -u origin gh-pages --force
git checkout main
```

Then in **Settings → Pages**, set **Source** to **Deploy from a branch**
and pick `gh-pages` / `/ (root)`.

### Why `.nojekyll`?

GitHub Pages runs the output through Jekyll by default, which strips
folders starting with `_`. `public/.nojekyll` is copied into `dist/` by
Vite and tells Pages to serve the files as-is. (The Actions workflow's
`upload-pages-artifact` already skips Jekyll, but the file makes manual
deploys safe too.)

## Static-host compatibility

The build is a fully static site (one HTML file + hashed JS/CSS in
`assets/`). It also works on Netlify, Vercel, Cloudflare Pages, S3 +
CloudFront, or any plain static host — `base: '/qrbookhub/'` is the
only project-specific path. For root-domain hosts (e.g. Netlify), set
`base: '/'` in `vite.config.js` before building.

## Project layout

```
qrbookhub/
├── .github/workflows/deploy.yml  # GH Pages CI
├── public/.nojekyll              # skip Jekyll on GH Pages
├── index.html                    # app shell
├── vite.config.js                # base: '/qrbookhub/' for build
├── package.json
└── src/
    ├── main.js                   # wiring + DOM + abort/cancel
    ├── scheduler.js              # runChunked / runChunkedAsync
    ├── qr-generator.js           # QRCodeStyling wrapper
    ├── url-parser.js             # paste parser + filename helpers
    ├── csv-parser.js             # RFC-4180-ish CSV parser
    ├── theme.js                  # light/dark toggle
    └── style.css
```
