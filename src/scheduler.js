const supportsIdle =
  typeof window !== 'undefined' &&
  typeof window.requestIdleCallback === 'function';

const FALLBACK_BUDGET_MS = 8;
const IDLE_TIMEOUT_MS = 200;

export function scheduleIdle(callback) {
  if (supportsIdle) {
    const id = window.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
    return { id, kind: 'idle' };
  }
  const start = performance.now();
  const id = setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => Math.max(0, FALLBACK_BUDGET_MS - (performance.now() - start)),
    });
  }, 0);
  return { id, kind: 'timeout' };
}

export function cancelScheduled(handle) {
  if (!handle) return;
  if (handle.kind === 'idle' && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(handle.id);
  } else if (handle.kind === 'timeout') {
    clearTimeout(handle.id);
  }
}

export function nextFrame() {
  return new Promise((resolve) =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => resolve())
      : setTimeout(resolve, 0)
  );
}

export function idle() {
  return new Promise((resolve) => scheduleIdle(() => resolve()));
}

export function runChunked({ count, work, onProgress, signal }) {
  return new Promise((resolve) => {
    if (count <= 0) {
      resolve({ aborted: false, completed: 0 });
      return;
    }
    if (signal && signal.aborted) {
      resolve({ aborted: true, completed: 0 });
      return;
    }

    let i = 0;
    let handle = null;
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      cancelScheduled(handle);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ aborted: true, completed: i });
    };

    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const step = (deadline) => {
      if (aborted) return;
      while (i < count && deadline.timeRemaining() > 1) {
        const idx = i++;
        try {
          work(idx);
        } catch (err) {
          console.error('runChunked work failed', err);
        }
        if (onProgress) onProgress(i, count);
        if (aborted) return;
      }
      if (i < count) {
        handle = scheduleIdle(step);
      } else {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve({ aborted: false, completed: i });
      }
    };

    handle = scheduleIdle(step);
  });
}

export async function runChunkedAsync({
  count,
  work,
  concurrency = 2,
  yieldEvery = 4,
  onProgress,
  signal,
}) {
  if (count <= 0) return { aborted: false, completed: 0 };
  if (signal && signal.aborted) return { aborted: true, completed: 0 };

  let next = 0;
  let done = 0;

  const worker = async () => {
    while (true) {
      if (signal && signal.aborted) return;
      const idx = next++;
      if (idx >= count) return;
      try {
        await work(idx);
      } catch (err) {
        console.error('runChunkedAsync work failed', err);
      }
      done++;
      if (onProgress) onProgress(done, count);
      if (done % yieldEvery === 0) await idle();
    }
  };

  const lanes = Math.max(1, Math.min(concurrency, count));
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return { aborted: !!(signal && signal.aborted), completed: done };
}
