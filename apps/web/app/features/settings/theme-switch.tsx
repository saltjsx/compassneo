import { SegmentedControl, SegmentedControlItem } from "@/components/glaze/ui/segmented-control";
import { Dark, Icon, Light } from "@/components/glaze/icon";
import { Button } from "@/components/glaze/ui/button";
import { chooseTheme, themeChoice, type ThemeChoice } from "@/lib/neo/theme";

/** Light, dark, or the device's: the whole screen cross-fades into the one chosen. */
export function ThemeSwitch({ className }: { className?: string }) {
  const choice = themeChoice.use();
  return (
    <SegmentedControl size="sm" fill value={choice} onValueChange={v => chooseTheme(v as ThemeChoice)} aria-label="Theme" className={className}>
      <SegmentedControlItem value="light">
        Light
      </SegmentedControlItem>
      <SegmentedControlItem value="dark">
        Dark
      </SegmentedControlItem>
      <SegmentedControlItem value="system">
        Auto
      </SegmentedControlItem>
    </SegmentedControl>
  );
}

/** One button that flips between light and dark, for screens with no room for the full switch (sign-in). */
export function ThemeToggle({ className }: { className?: string }) {
  const choice = themeChoice.use();
  const dark = typeof document !== "undefined" ? document.documentElement.dataset.theme !== "light" : choice !== "light";
  return (
    <Button variant="ghost" size="icon" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => chooseTheme(dark ? "light" : "dark")} className={className}>
      <Icon icon={dark ? Light : Dark} />
    </Button>
  );
}
