import { useCallback, useEffect, useState } from 'react';

export type AppTheme = 'dark' | 'light';

const THEME_KEY = 'opengaussian_theme';

function readStoredTheme(): AppTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
}

export function useTheme() {
  const [theme, setThemeState] = useState<AppTheme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_KEY) setThemeState(event.newValue === 'light' ? 'light' : 'dark');
    };
    const onThemeChange = (event: Event) => {
      const next = (event as CustomEvent<AppTheme>).detail;
      if (next === 'light' || next === 'dark') setThemeState(next);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('opengaussian-theme-change', onThemeChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('opengaussian-theme-change', onThemeChange);
    };
  }, []);

  const setTheme = useCallback((next: AppTheme) => {
    window.localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    setThemeState(next);
    window.dispatchEvent(new CustomEvent<AppTheme>('opengaussian-theme-change', { detail: next }));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [setTheme, theme]);

  return { theme, setTheme, toggleTheme };
}

export function ThemeSwitch() {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';

  return (
    <button
      className="theme-switch"
      type="button"
      role="switch"
      aria-checked={isLight}
      aria-label={`Switch to ${isLight ? 'dark' : 'light'} theme`}
      title={`Switch to ${isLight ? 'dark' : 'light'} theme`}
      onClick={toggleTheme}
    >
      <span className="theme-switch__track" aria-hidden="true">
        <span className="theme-switch__thumb" />
      </span>
      <span className="theme-switch__label">{isLight ? 'Light' : 'Dark'}</span>
    </button>
  );
}
