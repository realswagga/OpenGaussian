import { useCallback, useEffect, useState } from 'react';
import { useI18n } from './i18n';

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

type ThemeIconProps = {
  theme: AppTheme;
};

export function ThemeIcon({ theme }: ThemeIconProps) {
  return (
    <span className="theme-switch__icon" data-theme-state={theme} aria-hidden="true">
      <svg className="theme-switch__glyph theme-switch__glyph--sun" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3.8" />
        <path d="M12 2.5v2.1M12 19.4v2.1M4.6 4.6l1.5 1.5M17.9 17.9l1.5 1.5M2.5 12h2.1M19.4 12h2.1M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5" />
      </svg>
      <svg className="theme-switch__glyph theme-switch__glyph--moon" viewBox="0 0 24 24" fill="none">
        <path d="M18.4 15.1A7.3 7.3 0 0 1 8.9 5.6a7.7 7.7 0 1 0 9.5 9.5Z" />
      </svg>
    </span>
  );
}

export function ThemeSwitch() {
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';
  const nextTheme = isLight ? t('theme.dark') : t('theme.light');

  return (
    <button
      className="theme-switch"
      type="button"
      role="switch"
      aria-checked={isLight}
      aria-label={t('theme.switch', { theme: nextTheme })}
      title={t('theme.switch', { theme: nextTheme })}
      onClick={toggleTheme}
    >
      <ThemeIcon theme={theme} />
    </button>
  );
}
