"use client";

import { Icon } from "@/components/icons";

export function ThemeToggle() {
  const toggle = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("hf-theme", next);
    } catch {}
  };
  return (
    <button className="btn btn-icon theme" type="button" onClick={toggle} aria-label="Switch colour theme" title="Switch colour theme">
      <Icon name="theme" />
    </button>
  );
}
