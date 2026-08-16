"use client";

import { applyTheme, oppositeTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

export function ThemeToggle() {
  function toggleTheme() {
    const current = document.documentElement.dataset.theme as Theme || "dark";
    const next = oppositeTheme(current);
    applyTheme(document.documentElement, next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  return <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label="Toggle color theme" title="Toggle color theme">
    <svg className="theme-icon theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2.2M12 19.8V22M4.93 4.93l1.56 1.56M17.51 17.51l1.56 1.56M2 12h2.2M19.8 12H22M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56"/></svg>
    <svg className="theme-icon theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8a8.5 8.5 0 1 0 11.4 11.4Z"/></svg>
  </button>;
}
