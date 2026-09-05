export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'lb-theme';

type Listener = () => void;
const listeners = new Set<Listener>();

function readInitial(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

let current: Theme = readInitial();

export function currentTheme(): Theme {
  return current;
}

export function getTheme(): Theme {
  return current;
}

export function applyTheme(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
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
