"use client";

import { Moon, Sun } from "lucide-react";

import type { Theme } from "../hooks/useTheme";
import { APP_NAME, APP_TAGLINE } from "../lib/constants";
import { FullscreenControl } from "./FullscreenControl";

export function TopBar({
  theme,
  onToggleTheme
}: {
  theme: Theme;
  onToggleTheme: () => void;
}) {
  return (
    <header className="top" aria-label={APP_NAME}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-copy">
          <span className="brand-name">{APP_NAME}</span>
          <span className="brand-tagline">{APP_TAGLINE}</span>
        </span>
      </div>
      <div className="top-actions">
        <FullscreenControl />
        <button
          type="button"
          className="theme-pill"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
          <span>{theme === "dark" ? "Dark" : "Light"}</span>
        </button>
      </div>
    </header>
  );
}
