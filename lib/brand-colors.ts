/**
 * v2 changes, section D: per-task Brand coloring for calendar blocks.
 * Single source of truth for the Brand -> color table. `edge` is each
 * brand's solid accent color; `tint` is that same hue blended faintly into
 * the dark surface (v5 Stage 15 facelift) rather than into white, so a
 * brand-colored block still reads clearly on the new dark day-card
 * background instead of nearly disappearing.
 */
export type BrandColors = {
  label: string;
  /** Low-strength tint of the primary color, to use as the block background. */
  tint: string;
  /** Solid edge-bar color. */
  edge: string;
  dashed?: boolean;
};

const BRAND_TABLE: Record<string, BrandColors> = {
  scotland: { label: "Scotland", tint: "#1C2A33", edge: "#5FA3DB" },
  england: { label: "England", tint: "#1C2E22", edge: "#70C48F" },
  ireland: { label: "Ireland", tint: "#2E2614", edge: "#F0A24F" },
  wpt: { label: "WPT", tint: "#2A2233", edge: "#B896E0" },
  "wilderness group": { label: "Wilderness Group", tint: "#1A2E2E", edge: "#52C3CA" },
  mvlt: { label: "MVLT", tint: "#1E2926", edge: "#9AABB3" }, // not a Wilderness brand - kept monochrome
};

const NO_BRAND: BrandColors = { label: "No brand", tint: "#1E2926", edge: "#93A39C", dashed: true };

/** Looks up the Brand custom field value (case-insensitive, trimmed), falling back to the no-brand style. */
export function brandColorsFor(brand: string | null): BrandColors {
  if (brand == null) return NO_BRAND;
  const key = brand.trim().toLowerCase();
  return BRAND_TABLE[key] ?? NO_BRAND;
}

/**
 * v2 changes, section D: the Settings Office picker sets the app's accent
 * colour only — it never touches per-task Brand colours above. Reuses the
 * same six accent values so the two concepts can't quietly drift apart.
 */
export const OFFICES = ["Scotland", "England", "Ireland", "WPT", "MVLT", "Wilderness Group"] as const;
export type Office = (typeof OFFICES)[number];

export function officeAccentFor(office: string | null): { accent: string; onAccent: string } | null {
  if (office == null) return null;
  const key = office.trim().toLowerCase();
  const brand = BRAND_TABLE[key];
  if (!brand) return null;
  return { accent: brand.edge, onAccent: "#0C1C15" };
}
