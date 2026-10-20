import { cn } from "@/lib/cn";
import { ICON_PATHS, type IconName } from "./icons.generated";

export type { IconName };

/**
 * The portal's one icon system: Material Symbols (rounded, weight 400), inlined as path data by
 * scripts/dev/build-icons.mjs. One curated set, no icon font, no second library, no network
 * request, and no layout shift while a font loads.
 *
 * Accessibility: an icon is decoration unless it is given a `label`. Icons never carry a state on
 * their own — every status in this application is a word plus a colour plus (sometimes) a glyph,
 * so an operator who cannot tell the colours apart still reads the state.
 */
export const ICON_SIZE = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 } as const;
export type IconSize = keyof typeof ICON_SIZE | number;

/**
 * An unprefixed display utility in the caller's className, e.g. `hidden` next to our
 * `inline-block`. `cn` concatenates rather than resolving Tailwind conflicts, so both would land
 * on the element and the stylesheet's order, not the caller, would decide which won — a chevron
 * marked `hidden sm:block` still rendered on a phone. A responsive-only value such as `sm:block`
 * is deliberately not matched: that caller still wants our default below the breakpoint.
 */
const CALLER_SETS_DISPLAY = /(^|\s)(hidden|block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents)(\s|$)/;

export function Icon({ name, size = "md", filled = false, className, label }: { name: IconName; size?: IconSize; filled?: boolean; className?: string; label?: string }) {
  const px = typeof size === "number" ? size : ICON_SIZE[size];
  const base = CALLER_SETS_DISPLAY.test(className ?? "")
    ? "shrink-0 fill-current align-[-0.125em]"
    : "inline-block shrink-0 fill-current align-[-0.125em]";
  const d = ICON_PATHS[name][filled ? 1 : 0];
  return (
    <svg
      viewBox="0 -960 960 960"
      width={px}
      height={px}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
      className={cn(base, className)}
    >
      {label && <title>{label}</title>}
      <path d={d} />
    </svg>
  );
}

/** Icon-only control. The label is both the tooltip and the accessible name, so it is never optional. */
export function IconButton({ icon, label, filled, size = "md", className, ...rest }: { icon: IconName; label: string; filled?: boolean; size?: IconSize } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button type="button" title={label} aria-label={label} className={cn("inline-flex items-center justify-center rounded-[var(--radius-control)] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", className)} {...rest}>
      <Icon name={icon} size={size} filled={filled} />
    </button>
  );
}
