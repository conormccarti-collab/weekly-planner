import type { Weekday } from "./time";
import { weekdayOfDateStr } from "./time";

/** Only `avoid_weekday` rules are ever structurally enforced (lib/plan-build-data.ts) — conflict detection only makes sense for that kind. */
export type ActiveWeekdayRule = { id: string; weekday: Weekday; stage: string | null };

/**
 * v5 Stage 14a: "conflict reporting between rules." Two kinds of real
 * conflict, both deterministic (code, never the model):
 * 1. Exact duplicates — two active rules excluding the same weekday for the
 *    same stage (or both blanket, stage null) add nothing beyond each other.
 * 2. Together, a stage's own rule(s) plus any blanket rule exclude every
 *    working day — nothing of that stage could ever be placed at all.
 * Returns one message per affected rule id; a rule with no conflict is
 * simply absent from the map.
 */
export function findRuleConflicts(rules: ActiveWeekdayRule[], workingDays: Weekday[]): Map<string, string> {
  const conflicts = new Map<string, string>();

  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (rules[i].weekday === rules[j].weekday && rules[i].stage === rules[j].stage) {
        conflicts.set(rules[i].id, "Duplicates another active rule");
        conflicts.set(rules[j].id, "Duplicates another active rule");
      }
    }
  }

  const daysByStage = new Map<string | null, Set<Weekday>>();
  for (const r of rules) {
    const set = daysByStage.get(r.stage) ?? new Set<Weekday>();
    set.add(r.weekday);
    daysByStage.set(r.stage, set);
  }
  const blanketDays = daysByStage.get(null) ?? new Set<Weekday>();

  for (const [stage, days] of daysByStage) {
    if (stage === null) continue;
    const union = new Set([...days, ...blanketDays]);
    if (workingDays.every((d) => union.has(d))) {
      for (const r of rules) {
        if (r.stage === stage || r.stage === null) {
          conflicts.set(r.id, `Together with other active rules, excludes every working day for ${stage}`);
        }
      }
    }
  }

  if (workingDays.every((d) => blanketDays.has(d))) {
    for (const r of rules) {
      if (r.stage === null) conflicts.set(r.id, "Together, these rules exclude every working day entirely");
    }
  }

  return conflicts;
}

/**
 * v5 Stage 14a: "how many blocks this rule affected this week" — an honest,
 * directly-computable approximation (blocks actually sitting on the day
 * this rule excludes right now), not a counterfactual re-run of the
 * placement algorithm with/without the rule. A nonzero count on an active
 * rule usually means those blocks are pinned/protected and so exempt from
 * the rule, which is itself useful information to show alongside it.
 */
export function countBlocksOnExcludedDay(rule: ActiveWeekdayRule, placedDays: string[]): number {
  return placedDays.filter((day) => weekdayOfDateStr(day) === rule.weekday).length;
}
