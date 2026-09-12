export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'lb-theme';

type Listener = () => void;
const listeners = new Set<Listener>();

function readInitial(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

let current: Theme = readInitial();

/** Browser chrome (status bar, tab strip) matches the app surface. */
const META_BG: Record<Theme, string> = { dark: '#111417', light: '#f4f4f2' };

function syncMetaColor(theme: Theme): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', META_BG[theme]);
}

export function currentTheme(): Theme {
  return current;
}

export function getTheme(): Theme {
  return current;
}

export function applyTheme(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
  syncMetaColor(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode etc. — ignore */
  }
  listeners.forEach((l) => l());
}

/** Flip the theme, cross-fading colors via a short-lived `.theme-fading` gate. */
export function toggleTheme(): Theme {
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) root.classList.add('theme-fading');
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  if (!reduce) window.setTimeout(() => root.classList.remove('theme-fading'), 560);
  return next;
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Align the browser chrome with whichever theme the inline boot script set.
syncMetaColor(current);
