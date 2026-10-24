"use client";

import { ThemeToggler, type Resolved, type ThemeSelection } from "@animate-ui/react/primitives/effects/theme-toggler";
import { useTheme } from "next-themes";
import { Moon } from "@/components/animate-ui/icons/moon";
import { Sun } from "@/components/animate-ui/icons/sun";
import { ThemeTogglerButton, ThemeTogglerButtonIcon } from "@/components/animate-ui/buttons/theme-toggler";

/**
 * Light and dark in the top bar: the Animate UI Theme Toggler Button (the icon
 * turns into the next one) driving the Theme Toggler, which wipes the new theme
 * across the page from the reading direction's start. Reduced motion swaps at once.
 */
export function ThemeSwitch({ label, dir }: { label: string; dir: "rtl" | "ltr" }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <ThemeToggler
      theme={(theme ?? "system") as ThemeSelection}
      resolvedTheme={(resolvedTheme ?? "light") as Resolved}
      setTheme={setTheme}
      direction={dir}
    >
      {({ toggleTheme }) => (
        <ThemeTogglerButton
          theme={(theme ?? "system") as ThemeSelection}
          resolvedTheme={(resolvedTheme ?? "light") as Resolved}
          setTheme={toggleTheme}
          modes={["light", "dark"]}
          variant="ghost"
          size="sm"
          aria-label={label}
          title={label}
        >
          <ThemeTogglerButtonIcon light={<Sun className="size-4" />} dark={<Moon className="size-4" />} />
        </ThemeTogglerButton>
      )}
    </ThemeToggler>
  );
}
