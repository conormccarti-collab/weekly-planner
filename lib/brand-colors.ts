/**
 * v2 changes, section D: per-task Brand coloring for calendar blocks.
 * Single source of truth for the Brand -> color table. Tint strength (18% of
 * primary mixed into Slate #303634) and the "always use chalk text" rule were
 * picked after checking contrast ratios for every brand - all clear 8.9:1+.
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
  scotland: { label: "Scotland", tint: "#353A42", edge: "#8B90C1" },
  england: { label: "England", tint: "#463135", edge: "#DAA1A6" },
  ireland: { label: "Ireland", tint: "#2A3D32", edge: "#96AF72" },
  wpt: { label: "WPT", tint: "#323839", edge: "#BE9E61" },
  "wilderness group": { label: "Wilderness Group", tint: "#30403D", edge: "#65BBB0" },
  mvlt: { label: "MVLT", tint: "#2C2C2C", edge: "#FFFFFF" },
};

const NO_BRAND: BrandColors = { label: "No brand", tint: "#303634", edge: "#787F7C", dashed: true };

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
