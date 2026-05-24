# QRBookHub

Bulk QR code generator. Paste a list of links (one per line or comma-separated), generate styled QR codes in a responsive grid, and download them all as a ZIP. Runs entirely in the browser — no server, no upload.

Built for Google Drive book/file links, but works for any URL.

## Tech

- [Vite](https://vitejs.dev/) + vanilla JavaScript
- [qr-code-styling](https://github.com/kozakdenys/qr-code-styling) for QR rendering
- [JSZip](https://stuk.github.io/jszip/) + [FileSaver.js](https://github.com/eligrey/FileSaver.js) for batch download
- Deploys cleanly to GitHub Pages (static output)

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

The built site is in `dist/` — fully static, ready to host on GitHub Pages, Netlify, Vercel, or any static host.

## GitHub Pages

`vite.config.js` uses `base: './'`, so the built `dist/` works at any subpath. Push `dist/` to a `gh-pages` branch, or use the GitHub Actions workflow at `.github/workflows/deploy.yml`.

## Features

- Paste multiple URLs separated by newlines or commas
- Configurable QR size, margin, error correction level
- Async rendering with progress bar — handles hundreds of links smoothly
- Per-QR PNG / SVG download, copy URL, plus bulk ZIP download
- Manifest file included in ZIP (`manifest.tsv`)
- Modern dark/light responsive UI
- `Ctrl/Cmd + Enter` to generate
