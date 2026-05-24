import './style.css';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { parseEntries, fileBaseFor, looksLikeUrl } from './url-parser.js';
import { csvToEntries, entriesToTextareaFormat } from './csv-parser.js';
import { createQr, qrToBlob } from './qr-generator.js';
import { runChunked, runChunkedAsync } from './scheduler.js';
import { initThemeToggle } from './theme.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  textarea: $('#urls'),
  size: $('#qr-size'),
  margin: $('#qr-margin'),
  ecc: $('#qr-ecc'),
  generate: $('#generate'),
  download: $('#download'),
  clear: $('#clear'),
  importBtn: $('#import-btn'),
  trySample: $('#try-sample'),
  fileInput: $('#file-input'),
  themeToggle: $('#theme-toggle'),
  search: $('#search'),
  status: $('#status'),
  progress: $('#progress'),
  progressFill: $('#progress-fill'),
  progressText: $('#progress-text'),
  grid: $('#grid'),
  empty: $('#empty-state'),
  count: $('#results-count'),
  linkCount: $('#link-count'),
  primaryHint: $('#primary-hint'),
  resultsSub: $('#results-sub'),
  successBanner: $('#success-banner'),
  successHeadline: $('#success-headline'),
  successSub: $('#success-sub'),
  dropOverlay: $('#drop-overlay'),
  toastContainer: $('#toast-container'),
};

const SAMPLE_LINKS = `The Great Gatsby | https://drive.google.com/file/d/1AbcDefGhiJklMnoPqrStuVwxYz0001/view
1984 by George Orwell, https://drive.google.com/file/d/1AbcDefGhiJklMnoPqrStuVwxYz0002/view
To Kill a Mockingbird\thttps://drive.google.com/file/d/1AbcDefGhiJklMnoPqrStuVwxYz0003/view
Pride and Prejudice | https://drive.google.com/file/d/1AbcDefGhiJklMnoPqrStuVwxYz0004/view
The Catcher in the Rye, https://drive.google.com/file/d/1AbcDefGhiJklMnoPqrStuVwxYz0005/view
One Hundred Years of Solitude | https://drive.google.com/file/d/1AbcDefGhiJklMnoPqrStuVwxYz0006/view`;

const state = {
  items: [],
  busy: false,
  searchTerm: '',
  observer: null,
  controller: null,
  renderOptions: null,
  renderedCount: 0,
};

initThemeToggle(els.themeToggle);

/* ─── Helpers ──────────────────────────────────────────── */

function pluralize(n, singular, plural) {
  return n === 1 ? singular : (plural || `${singular}s`);
}

function setStatus(msg, kind = '') {
  els.status.textContent = msg || '';
  els.status.className = `status ${kind}`.trim();
}

function setProgress(done, total, label) {
  if (total <= 0) {
    els.progress.hidden = true;
    return;
  }
  els.progress.hidden = false;
  const pct = Math.round((done / total) * 100);
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = label || `${done} of ${total} done`;
}

function hideProgress() {
  els.progress.hidden = true;
  els.progressFill.style.width = '0%';
}

function showSuccessBanner(headline, sub) {
  els.successHeadline.textContent = headline;
  els.successSub.textContent = sub;
  els.successBanner.hidden = false;
}

function hideSuccessBanner() {
  els.successBanner.hidden = true;
}

function showToast(message, kind = 'success', durationMs = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.innerHTML = kind === 'error'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(icon, text);
  els.toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 260);
  }, durationMs);
}

/* ─── Live link counter ────────────────────────────────── */

function urlEntriesFrom(text) {
  if (!text || !text.trim()) return [];
  try {
    return parseEntries(text).filter((e) => looksLikeUrl(e.url));
  } catch {
    return [];
  }
}

function updateLinkCount() {
  const text = els.textarea.value;
  const trimmed = text.trim();
  const n = urlEntriesFrom(text).length;

  if (!trimmed) {
    els.linkCount.textContent = 'No links yet';
    els.linkCount.dataset.state = 'empty';
    els.primaryHint.textContent = 'Paste links above to get started.';
  } else if (n === 0) {
    els.linkCount.textContent = "Hmm, no URLs found";
    els.linkCount.dataset.state = 'warning';
    els.primaryHint.textContent = 'Add links that start with http:// or https:// to continue.';
  } else {
    els.linkCount.textContent = `${n} ${pluralize(n, 'link')} detected`;
    els.linkCount.dataset.state = 'active';
    els.primaryHint.textContent = `Ready to generate ${n} QR ${pluralize(n, 'code')}.`;
  }
}

/* ─── Results count / empty visibility ─────────────────── */

function updateCount() {
  const n = state.items.length;
  if (n === 0) {
    els.count.textContent = '';
    els.empty.classList.remove('hidden');
    els.search.hidden = true;
    els.resultsSub.textContent = "They'll appear here after you generate.";
    return;
  }
  const ok = state.items.filter((i) => !i.error).length;
  const visible = state.items.filter((i) => !i.hidden).length;
  const suffix = state.searchTerm ? ` · ${visible} shown` : '';
  els.count.textContent = `${ok} ready${ok !== n ? ` · ${n - ok} failed` : ''}${suffix}`;
  els.empty.classList.add('hidden');
  els.search.hidden = false;
  els.resultsSub.textContent = `${n} ${pluralize(n, 'code', 'codes')} generated. Click a card for download options.`;
}

function applyFilter() {
  const term = state.searchTerm.trim().toLowerCase();
  for (const item of state.items) {
    const matches =
      !term ||
      item.url.toLowerCase().includes(term) ||
      (item.name || '').toLowerCase().includes(term);
    item.hidden = !matches;
    if (item.cardEl) item.cardEl.classList.toggle('hidden', !matches);
  }
  updateCount();
}

/* ─── QR card ──────────────────────────────────────────── */

function makeCard(item, index) {
  const card = document.createElement('div');
  card.className = 'qr-card pending';
  card.dataset.index = String(index);

  const canvas = document.createElement('div');
  canvas.className = 'qr-canvas';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'qr-name';
  nameInput.placeholder = 'Untitled';
  nameInput.value = item.name || '';
  nameInput.spellcheck = false;
  nameInput.setAttribute('aria-label', 'QR code name');
  nameInput.addEventListener('input', () => {
    item.name = nameInput.value;
  });

  const urlEl = document.createElement('div');
  urlEl.className = 'qr-url';
  urlEl.textContent = item.url;
  urlEl.title = item.url;

  const actions = document.createElement('div');
  actions.className = 'qr-actions';

  const dlPng = document.createElement('button');
  dlPng.type = 'button';
  dlPng.textContent = 'PNG';
  dlPng.title = 'Download as PNG';
  dlPng.addEventListener('click', () => downloadSingle(item, 'png'));

  const dlSvg = document.createElement('button');
  dlSvg.type = 'button';
  dlSvg.textContent = 'SVG';
  dlSvg.title = 'Download as SVG';
  dlSvg.addEventListener('click', () => downloadSingle(item, 'svg'));

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.title = 'Copy link to clipboard';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      const orig = copy.textContent;
      copy.textContent = 'Copied!';
      setTimeout(() => (copy.textContent = orig), 1200);
    } catch {
      copy.textContent = 'Failed';
      setTimeout(() => (copy.textContent = 'Copy'), 1500);
    }
  });

  actions.append(dlPng, dlSvg, copy);
  card.append(canvas, nameInput, urlEl, actions);
  return { card, canvas };
}

function renderItem(item) {
  if (item.rendered || item.error) return false;
  try {
    const qr = createQr({ data: item.url, ...state.renderOptions });
    qr.append(item.canvasEl);
    item.qr = qr;
    item.rendered = true;
    item.cardEl.classList.remove('pending');
    state.renderedCount++;
    setProgress(state.renderedCount, state.items.length);
    return true;
  } catch (err) {
    item.error = err.message || 'Could not render this link';
    item.cardEl.classList.add('error');
    item.cardEl.classList.remove('pending');
    item.canvasEl.textContent = item.error;
    state.renderedCount++;
    setProgress(state.renderedCount, state.items.length);
    return true;
  }
}

async function ensureQrForBlob(item) {
  if (item.qr) return item.qr;
  return createQr({ data: item.url, ...state.renderOptions });
}

async function downloadSingle(item, ext) {
  if (item.error) return;
  try {
    const qr = await ensureQrForBlob(item);
    const blob = await qrToBlob(qr, ext);
    saveAs(blob, `${fileBaseFor(item)}.${ext}`);
    showToast(`Saved ${fileBaseFor(item)}.${ext}`, 'success', 2400);
  } catch (err) {
    console.error(err);
    showToast(`Couldn't save the file — ${err.message}`, 'error');
  }
}

function abortCurrent() {
  if (state.controller) {
    state.controller.abort();
    state.controller = null;
  }
  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }
}

/* ─── Generate ─────────────────────────────────────────── */

async function generate() {
  if (state.busy) return;
  abortCurrent();
  hideSuccessBanner();

  const text = els.textarea.value;
  if (!text.trim()) {
    setStatus("Paste at least one link in the box above, then click Generate.", 'error');
    els.textarea.focus();
    return;
  }

  const entries = urlEntriesFrom(text);
  if (entries.length === 0) {
    setStatus("We couldn't find any URLs in there. Try pasting links that start with http:// or https://, one per line.", 'error');
    els.textarea.focus();
    return;
  }

  const controller = new AbortController();
  state.controller = controller;
  state.busy = true;
  els.generate.disabled = true;
  els.download.disabled = true;
  setStatus(`Getting ready to generate ${entries.length} QR ${pluralize(entries.length, 'code')}…`);

  els.grid.innerHTML = '';
  state.items = entries.map((e) => ({
    name: e.name,
    url: e.url,
    qr: null,
    rendered: false,
    error: null,
    hidden: false,
    cardEl: null,
    canvasEl: null,
  }));
  state.renderOptions = {
    size: Number(els.size.value),
    margin: Number(els.margin.value),
    ecc: els.ecc.value,
  };
  state.renderedCount = 0;

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    const { card, canvas } = makeCard(item, i);
    item.cardEl = card;
    item.canvasEl = canvas;
    fragment.appendChild(card);
  }
  els.grid.appendChild(fragment);

  updateCount();
  applyFilter();
  setProgress(0, state.items.length);

  const observer = new IntersectionObserver(
    (intersections) => {
      for (const entry of intersections) {
        if (!entry.isIntersecting) continue;
        const idx = Number(entry.target.dataset.index);
        const item = state.items[idx];
        if (item) renderItem(item);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '300px 0px', threshold: 0 }
  );
  for (const item of state.items) observer.observe(item.cardEl);
  state.observer = observer;

  setStatus(`Generating ${state.items.length} QR ${pluralize(state.items.length, 'code')}…`);

  const result = await runChunked({
    count: state.items.length,
    work: (i) => renderItem(state.items[i]),
    signal: controller.signal,
  });

  state.busy = false;
  els.generate.disabled = false;
  updateCount();

  if (result.aborted) {
    setStatus('Stopped.', 'error');
    setTimeout(hideProgress, 400);
    return;
  }

  const total = state.items.length;
  const failed = state.items.filter((i) => i.error).length;
  const ok = total - failed;

  setStatus('');
  setTimeout(hideProgress, 400);

  if (ok > 0) {
    els.download.disabled = false;
    const headline = `${ok} QR ${pluralize(ok, 'code', 'codes')} ready!`;
    const sub = failed === 0
      ? 'Download them all as a single ZIP, or grab individual files from each card.'
      : `${failed} ${pluralize(failed, 'link')} couldn't be turned into a QR code — the others are ready.`;
    showSuccessBanner(headline, sub);
    // Scroll the banner into view on smaller screens for visibility
    if (window.innerWidth < 900) {
      els.successBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } else {
    setStatus("None of the links could be turned into QR codes. Double-check that they're valid URLs.", 'error');
  }
}

/* ─── Download ZIP ─────────────────────────────────────── */

async function downloadZip() {
  if (state.busy) return;
  const ready = state.items.filter((i) => !i.error);
  if (ready.length === 0) return;

  abortCurrent();
  const controller = new AbortController();
  state.controller = controller;
  state.busy = true;
  els.download.disabled = true;
  els.generate.disabled = true;
  setStatus(`Packing ${ready.length} QR ${pluralize(ready.length, 'code')} into a ZIP…`);
  setProgress(0, ready.length, `0 of ${ready.length} packed`);

  const zip = new JSZip();
  const folder = zip.folder('qrcodes');
  const seenNames = new Map();

  await runChunkedAsync({
    count: ready.length,
    concurrency: 2,
    yieldEvery: 4,
    signal: controller.signal,
    onProgress: (done, total) => setProgress(done, total, `${done} of ${total} packed`),
    work: async (i) => {
      const item = ready[i];
      try {
        const qr = await ensureQrForBlob(item);
        const blob = await qrToBlob(qr, 'png');
        const base = fileBaseFor(item);
        const count = (seenNames.get(base) || 0) + 1;
        seenNames.set(base, count);
        const name = count === 1 ? `${base}.png` : `${base}-${count}.png`;
        folder.file(name, blob);
      } catch (err) {
        console.error('zip add failed', err);
      }
    },
  });

  if (controller.signal.aborted) {
    state.busy = false;
    els.generate.disabled = false;
    els.download.disabled = false;
    updateCount();
    setStatus('Stopped.', 'error');
    setTimeout(hideProgress, 400);
    return;
  }

  const manifestLines = state.items.map((it, i) => {
    const status = it.error ? 'ERROR' : 'OK';
    const name = (it.name || '').replace(/\t/g, ' ');
    return `${i + 1}\t${status}\t${name}\t${it.url}`;
  });
  folder.file(
    'manifest.tsv',
    `# index\tstatus\tname\turl\n${manifestLines.join('\n')}\n`
  );

  setStatus('Compressing your ZIP…');
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
  updateCount();
  setStatus('');
  setTimeout(hideProgress, 400);

  showToast(`Downloaded ${ready.length} QR ${pluralize(ready.length, 'code', 'codes')} as a ZIP`, 'success', 4000);
}

/* ─── Clear / Sample ───────────────────────────────────── */

function clearAll() {
  abortCurrent();
  state.busy = false;
  els.textarea.value = '';
  els.search.value = '';
  state.items = [];
  state.searchTerm = '';
  state.renderedCount = 0;
  els.grid.innerHTML = '';
  els.generate.disabled = false;
  els.download.disabled = true;
  hideSuccessBanner();
  setStatus('');
  hideProgress();
  updateLinkCount();
  updateCount();
  els.textarea.focus();
}

function loadSample() {
  els.textarea.value = SAMPLE_LINKS;
  updateLinkCount();
  showToast('Loaded 6 sample links — click Generate to try it', 'info', 3200);
  els.textarea.focus();
}

/* ─── File import ──────────────────────────────────────── */

async function handleFile(file) {
  if (!file) return;
  const name = file.name || 'file';
  const lowered = name.toLowerCase();

  let text;
  try {
    text = await file.text();
  } catch {
    showToast(`Couldn't read ${name}`, 'error');
    return;
  }

  let entries;
  if (lowered.endsWith('.csv') || lowered.endsWith('.tsv') || file.type === 'text/csv') {
    entries = csvToEntries(text);
  } else {
    entries = parseEntries(text);
  }

  if (entries.length === 0) {
    setStatus(`No links found in ${name}. Make sure your file has URLs starting with http:// or https://.`, 'error');
    showToast(`No links in ${name}`, 'error');
    return;
  }
  els.textarea.value = entriesToTextareaFormat(entries);
  updateLinkCount();
  setStatus('');
  showToast(`Loaded ${entries.length} ${pluralize(entries.length, 'link')} from ${name}`, 'success');
}

/* ─── Event wiring ─────────────────────────────────────── */

els.importBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) await handleFile(file);
  els.fileInput.value = '';
});

let dragDepth = 0;
function isFileDrag(e) {
  if (!e.dataTransfer) return false;
  return Array.from(e.dataTransfer.types || []).includes('Files');
}

window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  els.dropOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) els.dropOverlay.hidden = true;
});
window.addEventListener('drop', async (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.dropOverlay.hidden = true;
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) await handleFile(file);
});

let searchDebounce = null;
els.search.addEventListener('input', () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.searchTerm = els.search.value;
    applyFilter();
  }, 80);
});

let countDebounce = null;
els.textarea.addEventListener('input', () => {
  if (countDebounce) clearTimeout(countDebounce);
  countDebounce = setTimeout(updateLinkCount, 100);
});

els.generate.addEventListener('click', generate);
els.download.addEventListener('click', downloadZip);
els.clear.addEventListener('click', clearAll);
els.trySample.addEventListener('click', loadSample);

els.textarea.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    generate();
  }
});

updateLinkCount();
updateCount();
