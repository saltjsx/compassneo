import { useEffect } from "react";
import { day, night } from "@compassneo/brand";
import { persisted } from "./store";
import { morph } from "./morph";

/**
 * Light, dark, or following the device. Dark is the default. The choice is kept on the device; root.tsx applies it
 * before the first paint (THEME_SCRIPT), so a light-theme reload never flashes dark.
 */
export type ThemeChoice = "light" | "dark" | "system";

const KEY = "cneo.theme.v1";
export const themeChoice = persisted<ThemeChoice>(KEY, "dark");

const prefersDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
const resolve = (c: ThemeChoice) => (c === "system" ? (prefersDark() ? "dark" : "light") : c);

function apply(c: ThemeChoice) {
  const theme = resolve(c);
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? night.page : day.page);
}

/** How long the new theme takes to wash across the screen, and how it moves: quick out of the corner, settling. */
const WIPE_MS = 560;
const WIPE_EASE = "cubic-bezier(0.33, 0, 0.2, 1)";

/**
 * The wipe: the new theme's picture is revealed by a circle growing from the top-left corner until it covers the far
 * one, over the old theme's picture held still beneath it (brand.css, data-morph="theme").
 */
function wipe() {
  const radius = Math.ceil(Math.hypot(window.innerWidth, window.innerHeight));
  document.documentElement.animate(
    { clipPath: ["circle(0px at 0px 0px)", `circle(${radius}px at 0px 0px)`] },
    { duration: WIPE_MS, easing: WIPE_EASE, pseudoElement: "::view-transition-new(root)" },
  );
}

/** Puts a theme on the screen with the wipe (or at once, without view transitions or with reduced motion). */
function wipeTo(update: () => void) {
  void morph(update, "theme", wipe);
}

/** Choosing a theme washes the whole screen into it from the corner. */
export function chooseTheme(c: ThemeChoice) {
  if (resolve(c) === document.documentElement.dataset.theme) return themeChoice.set(c);
  wipeTo(() => {
    themeChoice.set(c);
    apply(c);
  });
}

/** Keeps <html> on the chosen theme, and on the device's when following it. Mounted once, in root.tsx. */
export function useTheme() {
  const choice = themeChoice.use();
  useEffect(() => {
    apply(choice);
    if (choice !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    // Following the device: when it changes (at sunset, say), the screen washes into the new theme too.
    const follow = () => (resolve("system") === document.documentElement.dataset.theme ? undefined : wipeTo(() => apply("system")));
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, [choice]);
  return choice;
}

/** Runs in <head> before anything paints: the kept choice onto <html>. */
export const THEME_SCRIPT = `try{var c=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})||'"dark"');var d=c==="dark"||(c==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=d?${JSON.stringify(night.page)}:${JSON.stringify(day.page)}}catch(e){}`;
