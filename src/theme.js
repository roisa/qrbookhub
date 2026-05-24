const STORAGE_KEY = 'qrbookhub-theme';

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {}
  return null;
}

export function setStoredTheme(value) {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, value);
  } catch {}
}

export function systemPrefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

export function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export function initThemeToggle(button) {
  const update = () => {
    const stored = getStoredTheme();
    const effective = stored || (systemPrefersDark() ? 'dark' : 'light');
    applyTheme(stored);
    button.dataset.theme = effective;
    button.setAttribute('aria-label', `Switch to ${effective === 'dark' ? 'light' : 'dark'} mode`);
    button.title = `Theme: ${stored || 'system'} — click to toggle`;
  };

  button.addEventListener('click', () => {
    const stored = getStoredTheme();
    const effective = stored || (systemPrefersDark() ? 'dark' : 'light');
    const next = effective === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    update();
  });

  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      if (!getStoredTheme()) update();
    };
    if (mq.addEventListener) mq.addEventListener('change', listener);
    else if (mq.addListener) mq.addListener(listener);
  }

  update();
}
