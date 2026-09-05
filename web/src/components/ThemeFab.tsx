import { useEffect, useState } from 'react';
import { currentTheme, toggleTheme, subscribeTheme, type Theme } from '../theme';
import { ContrastGlyph } from './ThemeToggle';

export default function ThemeFab() {
  const [theme, setTheme] = useState<Theme>(currentTheme());

  useEffect(() => subscribeTheme(() => setTheme(currentTheme())), []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} mode`;

  return (
    <button type="button" className="ld-theme-fab" onClick={() => toggleTheme()} aria-label={label} title={label}>
      <span className="tt-glyph" data-mode={theme}>
        <ContrastGlyph />
      </span>
    </button>
  );
}
