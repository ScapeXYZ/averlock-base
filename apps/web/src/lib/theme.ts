export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "averlock-theme";

export function resolveTheme(storedTheme: string | null, systemPrefersDark: boolean): Theme {
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return systemPrefersDark ? "dark" : "light";
}

export function applyTheme(root: Pick<HTMLElement, "dataset" | "style">, theme: Theme) {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function oppositeTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}
