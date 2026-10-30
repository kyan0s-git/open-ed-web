import { useSyncExternalStore } from "react";

/**
 * Light, dark, or follow the system.
 *
 * The choice is applied as data-theme on <html>, which the tokens in theme.css key off.
 * index.html applies the stored choice in an inline script before first paint, so a
 * reload never flashes the wrong theme; this module keeps it in sync afterwards.
 */

export type ThemePreference = "system" | "light" | "dark";

const KEY = "open-ed-web:theme";
const listeners = new Set<() => void>();

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, preference);
  } catch {
    // Storage can be unavailable (private windows); the choice still applies this session.
  }
  applyTheme(preference);
  for (const listener of listeners) listener();
}

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

/** What is actually showing, resolving "system" against the OS setting. */
export function effectiveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let current = typeof window === "undefined" ? "system" : getThemePreference();

const subscribe = (listener: () => void) => {
  const update = () => {
    current = getThemePreference();
    listener();
  };
  listeners.add(update);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(update);
    media.removeEventListener("change", listener);
  };
};

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => current, () => "system");
}

/** Cycle system -> light -> dark, for a single toggle button. */
export function nextPreference(preference: ThemePreference): ThemePreference {
  return preference === "system" ? "light" : preference === "light" ? "dark" : "system";
}
