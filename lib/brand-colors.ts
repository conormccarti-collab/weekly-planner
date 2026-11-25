/**
 * v2 changes, section D: per-task Brand coloring for calendar blocks.
 * Single source of truth for the Brand -> color table. `edge` is each
 * brand's actual swatch from the brand guide
 * (wildernessscotland.com/brand-guidelines); `tint` is that same hue mixed
 * 10% into white, computed (not eyeballed) so every brand reads consistently
 * pale - all clear 8.9:1+ with chalk (Raven) text on every tint below.
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
  scotland: { label: "Scotland", tint: "#F3F4F9", edge: "#8B90C1" }, // Thistle
  england: { label: "England", tint: "#FBF6F6", edge: "#DAA1A6" }, // Rose
  ireland: { label: "Ireland", tint: "#F5F7F1", edge: "#96AF72" }, // Shamrock
  wpt: { label: "WPT", tint: "#F9F5EF", edge: "#BE9E61" }, // Ochre
  "wilderness group": { label: "Wilderness Group", tint: "#F0F8F7", edge: "#65BBB0" }, // Lough
  mvlt: { label: "MVLT", tint: "#F3F3F1", edge: "#1D1D1D" }, // not a Wilderness brand - kept monochrome (Raven)
};

const NO_BRAND: BrandColors = { label: "No brand", tint: "#F0ECEE", edge: "#828276", dashed: true }; // Chalk / Dove

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

/** Raven (#1D1D1D) reads at 5.5:1+ against every one of these — checked, not assumed. */
export function officeAccentFor(office: string | null): { accent: string; onAccent: string } | null {
  if (office == null) return null;
  const key = office.trim().toLowerCase();
  const brand = BRAND_TABLE[key];
  if (!brand) return null;
  return { accent: brand.edge, onAccent: "#1D1D1D" };
}
