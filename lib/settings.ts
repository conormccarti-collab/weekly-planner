import { PIPELINE_PROJECT_GID, PRODUCTION_SHOOTS_PROJECT_GID } from "./asana/projects";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export type Settings = {
  working_days: Weekday[];
  hours_per_day: number;
  start_times: Partial<Record<Weekday, string>>;
  lunch_times: Partial<Record<Weekday, string>>;
  lunch_minutes: number;
  planning_percentage: number;
  min_deep_work_block_minutes: number;
  timezone: string;
  /** v2 changes, section D: sets the app's accent colour only — never per-task Brand. */
  office: string | null;
  /** v4 Stage 7, brief section 10: one email each weekday morning — off by default. */
  notifications_enabled: boolean;
  /** v5 Stage 12d: project gids eligible to be planned, placed and flagged at all. Defaults to Visual Content Pipeline + Production & Shoots. */
  planned_project_gids: string[];
  /**
   * v5 Stage 12g §C: a break (lunch) kept free by the planner. Off by
   * default — note lunch_minutes/lunch_times above were always applied
   * unconditionally before this existed (see lib/capacity.ts); this makes
   * that opt-in. "fixed" keeps today's behaviour (lunch_times, unconditional).
   * "flexible" floats lunch_minutes somewhere free inside the window below,
   * dodging meetings, instead of a fixed clock time.
   */
  /** Defaults true — lunch was unconditionally applied before this setting existed; this preserves that until the user changes it (see migration 0025). */
  lunch_enabled: boolean;
  lunch_mode: "fixed" | "flexible";
  lunch_window_start: string;
  lunch_window_end: string;
  /** v5 Stage 12g §B: "Minimum part size is a setting (default 1h)." */
  min_split_part_minutes: number;
};

export const DEFAULT_SETTINGS: Settings = {
  working_days: ["mon", "tue", "wed", "thu", "fri"],
  hours_per_day: 7,
  start_times: { mon: "09:30", tue: "08:30", wed: "08:30", thu: "08:30", fri: "08:30" },
  lunch_times: { mon: "12:30", tue: "12:30", wed: "12:30", thu: "12:30", fri: "12:30" },
  lunch_minutes: 60,
  planning_percentage: 100,
  min_deep_work_block_minutes: 60,
  timezone: "Europe/London",
  office: null,
  notifications_enabled: false,
  planned_project_gids: [PIPELINE_PROJECT_GID, PRODUCTION_SHOOTS_PROJECT_GID],
  lunch_enabled: true,
  lunch_mode: "fixed",
  lunch_window_start: "12:00",
  lunch_window_end: "14:00",
  min_split_part_minutes: 60,
};
