"use client";

import { useEffect, useState } from "react";

const THEME_CHANGE = "flood-theme-change";

export function dispatchThemeChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(THEME_CHANGE));
}

export function useThemeTokens(): { chartGrid: string; chartText: string } {
  const [tokens, setTokens] = useState({ chartGrid: "#e5e5e5", chartText: "#4e4b4b" });

  useEffect(() => {
    function read() {
      const root = document.documentElement;
      const grid = root.style.getPropertyValue("--color-chart-grid").trim();
      const text = root.style.getPropertyValue("--color-chart-text").trim();
      setTokens({
        chartGrid: grid || (root.classList.contains("dark") ? "#3a3a3c" : "#e5e5e5"),
        chartText: text || (root.classList.contains("dark") ? "#aeaeb2" : "#4e4b4b"),
      });
    }
    read();
    window.addEventListener(THEME_CHANGE, read);
    return () => window.removeEventListener(THEME_CHANGE, read);
  }, []);

  return tokens;
}
