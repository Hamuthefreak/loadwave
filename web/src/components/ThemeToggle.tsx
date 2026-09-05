import { useEffect, useState } from 'react';
import { currentTheme, toggleTheme, subscribeTheme, type Theme } from '../theme';

/**
 * Contrast glyph — a circle, half filled. Reads as "dark side / light side"
 * in either mode, so one mark works for both directions. The square mounts
 * rotate it 180deg when the theme flips for a tactile switch feel.
 */
export function ContrastGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* Kept for compatibility with existing imports. */
export const SunIcon = ContrastGlyph;
export const MoonIcon = ContrastGlyph;

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(currentTheme());

  useEffect(() => subscribeTheme(() => setTheme(currentTheme())), []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} mode`;

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      onClick={() => toggleTheme()}
      aria-label={label}
      title={label}
    >
      <span className="tt-glyph" data-mode={theme}>
        <ContrastGlyph />
      </span>
    </button>
  );
}
