import './style.css';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { parseUrls, describeUrl } from './url-parser.js';
import { createQr, qrToBlob, nextFrame, idle } from './qr-generator.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  textarea: $('#urls'),
  size: $('#qr-size'),
  margin: $('#qr-margin'),
  ecc: $('#qr-ecc'),
  generate: $('#generate'),
  download: $('#download'),
  clear: $('#clear'),
  status: $('#status'),
  progress: $('#progress'),
  progressFill: $('#progress-fill'),
  progressText: $('#progress-text'),
  grid: $('#grid'),
  empty: $('#empty-state'),
  count: $('#results-count'),
};

const state = {
  items: [],
  busy: false,
};

function setStatus(msg, kind = '') {
  els.status.textContent = msg || '';
  els.status.className = `status ${kind}`.trim();
}

function setProgress(done, total) {
  if (total <= 0) {
    els.progress.hidden = true;
    return;
  }
  els.progress.hidden = false;
  const pct = Math.round((done / total) * 100);
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = `${done} / ${total} rendered`;
}

function updateCount() {
  const n = state.items.length;
  if (n === 0) {
    els.count.textContent = '';
    els.empty.classList.remove('hidden');
    els.download.disabled = true;
  } else {
    const ok = state.items.filter((i) => !i.error).length;
    els.count.textContent = `${ok} ready${ok !== n ? ` · ${n - ok} failed` : ''}`;
    els.empty.classList.add('hidden');
    els.download.disabled = ok === 0;
  }
}

function makeCard(item, index) {
  const card = document.createElement('div');
  card.className = 'qr-card';
  card.dataset.index = String(index);

  const canvas = document.createElement('div');
  canvas.className = 'qr-canvas';

  const label = document.createElement('div');
  label.className = 'qr-label';
  label.textContent = item.url;
  label.title = item.url;

  const actions = document.createElement('div');
  actions.className = 'qr-actions';

  const dlPng = document.createElement('button');
  dlPng.type = 'button';
  dlPng.textContent = 'PNG';
  dlPng.addEventListener('click', () => downloadSingle(item, 'png'));

  const dlSvg = document.createElement('button');
  dlSvg.type = 'button';
  dlSvg.textContent = 'SVG';
  dlSvg.addEventListener('click', () => downloadSingle(item, 'svg'));

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy URL';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      copy.textContent = 'Copied!';
      setTimeout(() => (copy.textContent = 'Copy URL'), 1200);
    } catch {
      copy.textContent = 'Failed';
    }
  });

  actions.append(dlPng, dlSvg, copy);
  card.append(canvas, label, actions);
  return { card, canvas };
}

async function downloadSingle(item, ext) {
  if (item.error || !item.qr) return;
  try {
    const blob = await qrToBlob(item.qr, ext);
    const name = `${describeUrl(item.url)}.${ext}`;
    saveAs(blob, name);
  } catch (err) {
    console.error(err);
    setStatus(`Failed to download: ${err.message}`, 'error');
  }
}

async function generate() {
  if (state.busy) return;

  const urls = parseUrls(els.textarea.value);
  if (urls.length === 0) {
    setStatus('No URLs detected. Paste links separated by newlines or commas.', 'error');
    return;
  }

  state.busy = true;
  els.generate.disabled = true;
  els.download.disabled = true;
  setStatus(`Generating ${urls.length} QR code${urls.length === 1 ? '' : 's'}…`);

  els.grid.innerHTML = '';
  state.items = urls.map((url) => ({ url, qr: null, error: null }));
  updateCount();

  const size = Number(els.size.value);
  const margin = Number(els.margin.value);
  const ecc = els.ecc.value;

  const cardEls = state.items.map((item, i) => {
    const { card, canvas } = makeCard(item, i);
    els.grid.appendChild(card);
    return { card, canvas };
  });

  setProgress(0, state.items.length);

  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    const { card, canvas } = cardEls[i];
    try {
      const qr = createQr({ data: item.url, size, margin, ecc });
      qr.append(canvas);
      item.qr = qr;
    } catch (err) {
      item.error = err.message || 'Render failed';
      card.classList.add('error');
      canvas.textContent = item.error;
    }
    setProgress(i + 1, state.items.length);
    if (i % 8 === 7) {
      await nextFrame();
      await idle();
    }
  }

  state.busy = false;
  els.generate.disabled = false;
  updateCount();

  const failed = state.items.filter((i) => i.error).length;
  if (failed === 0) {
    setStatus(`Done. ${state.items.length} QR code${state.items.length === 1 ? '' : 's'} ready.`, 'success');
  } else {
    setStatus(`Done with ${failed} error${failed === 1 ? '' : 's'}.`, 'error');
  }
  setTimeout(() => setProgress(0, 0), 800);
}

async function downloadZip() {
  if (state.busy) return;
  const ready = state.items.filter((i) => !i.error && i.qr);
  if (ready.length === 0) return;

  state.busy = true;
  els.download.disabled = true;
  els.generate.disabled = true;
  setStatus(`Packaging ${ready.length} QR code${ready.length === 1 ? '' : 's'} into ZIP…`);
  setProgress(0, ready.length);

  const zip = new JSZip();
  const folder = zip.folder('qrcodes');
  const seenNames = new Map();

  for (let i = 0; i < ready.length; i++) {
    const item = ready[i];
    try {
      const blob = await qrToBlob(item.qr, 'png');
      let base = describeUrl(item.url);
      const count = (seenNames.get(base) || 0) + 1;
      seenNames.set(base, count);
      const name = count === 1 ? `${base}.png` : `${base}-${count}.png`;
      folder.file(name, blob);
    } catch (err) {
      console.error('zip add failed', err);
    }
    setProgress(i + 1, ready.length);
    if (i % 6 === 5) await idle();
  }

  const manifest = state.items
    .map((it, i) => `${i + 1}\t${it.error ? 'ERROR' : 'OK'}\t${it.url}`)
    .join('\n');
  folder.file('manifest.tsv', `# index\tstatus\turl\n${manifest}\n`);

  setStatus('Compressing…');
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => {
      els.progressFill.style.width = `${Math.round(meta.percent)}%`;
      els.progressText.textContent = `Compressing… ${Math.round(meta.percent)}%`;
    }
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  saveAs(blob, `qrbookhub-${stamp}.zip`);

  state.busy = false;
  els.generate.disabled = false;
  els.download.disabled = false;
  setStatus(`Downloaded ${ready.length} QR code${ready.length === 1 ? '' : 's'} as ZIP.`, 'success');
  setTimeout(() => setProgress(0, 0), 800);
}

function clearAll() {
  if (state.busy) return;
  els.textarea.value = '';
  state.items = [];
  els.grid.innerHTML = '';
  setStatus('');
  setProgress(0, 0);
  updateCount();
  els.textarea.focus();
}

els.generate.addEventListener('click', generate);
els.download.addEventListener('click', downloadZip);
els.clear.addEventListener('click', clearAll);

els.textarea.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    generate();
  }
});

updateCount();
