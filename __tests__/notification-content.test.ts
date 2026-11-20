import { describe, expect, it } from "vitest";
import { hasAnythingToReport, renderNotificationEmail, type NotificationContent } from "@/lib/notification-content";

function content(overrides: Partial<NotificationContent> = {}): NotificationContent {
  return { morningCheckOutstanding: [], deadlineRisks: [], hygieneIssues: [], ...overrides };
}

describe("hasAnythingToReport", () => {
  it("is false when all three sections are empty", () => {
    expect(hasAnythingToReport(content())).toBe(false);
  });

  it("is true when any one section has something", () => {
    expect(hasAnythingToReport(content({ morningCheckOutstanding: ["Edit the cut"] }))).toBe(true);
    expect(hasAnythingToReport(content({ deadlineRisks: ["X due tomorrow"] }))).toBe(true);
    expect(hasAnythingToReport(content({ hygieneIssues: ["Brand is blank"] }))).toBe(true);
  });
});

describe("renderNotificationEmail", () => {
  it("includes the date in the subject", () => {
    const { subject } = renderNotificationEmail(content(), "2026-11-23");
    expect(subject).toContain("2026-11-23");
  });

  it("omits a section with nothing to report", () => {
    const { text } = renderNotificationEmail(content({ morningCheckOutstanding: ["Edit the cut"] }), "2026-11-23");
    expect(text).toContain("Morning check still outstanding");
    expect(text).not.toContain("Deadline risks");
    expect(text).not.toContain("Hygiene flags");
  });

  it("includes every non-empty section", () => {
    const { text } = renderNotificationEmail(
      content({ morningCheckOutstanding: ["A"], deadlineRisks: ["B"], hygieneIssues: ["C"] }),
      "2026-11-23"
    );
    expect(text).toContain("A");
    expect(text).toContain("B");
    expect(text).toContain("C");
  });
});
