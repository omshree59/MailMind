import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gmailQuery, missedPeriodLabel, nextScheduledInstant, periodFromDates, previousReportingPeriod, zonedParts, zonedTimeToUtc } from "../src/period";

describe("reporting periods", () => {
  it("uses the previous calendar day in Asia/Kolkata across the UTC date boundary", () => {
    const period = previousReportingPeriod(new Date("2026-10-11T19:00:00.000Z"), "Asia/Kolkata");
    assert.equal(period.label, "2026-10-11");
    assert.equal(period.start.toISOString(), "2026-10-10T18:30:00.000Z");
    assert.equal(period.end.toISOString(), "2026-10-11T18:30:00.000Z");
    assert.equal(
      gmailQuery(period),
      `in:inbox category:primary -category:promotions -category:updates -category:social -category:forums after:${Math.floor(period.start.getTime() / 1000)} before:${Math.floor(period.end.getTime() / 1000)}`,
    );
  });

  it("keeps the day before a local midnight", () => {
    const period = previousReportingPeriod(new Date("2026-10-11T18:29:00.000Z"), "Asia/Kolkata");
    assert.equal(period.label, "2026-10-10");
    assert.equal(period.end.toISOString(), "2026-10-10T18:30:00.000Z");
  });

  it("handles the 23-hour spring-forward day in New York", () => {
    const period = previousReportingPeriod(new Date("2026-03-09T16:00:00.000Z"), "America/New_York");
    assert.equal(period.label, "2026-03-08");
    assert.equal(period.start.toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(period.end.toISOString(), "2026-03-09T04:00:00.000Z");
    assert.equal(period.end.getTime() - period.start.getTime(), 23 * 60 * 60 * 1000);
  });

  it("handles the 25-hour fall-back day in New York", () => {
    const period = previousReportingPeriod(new Date("2026-11-02T17:00:00.000Z"), "America/New_York");
    assert.equal(period.label, "2026-11-01");
    assert.equal(period.start.toISOString(), "2026-11-01T04:00:00.000Z");
    assert.equal(period.end.toISOString(), "2026-11-02T05:00:00.000Z");
    assert.equal(period.end.getTime() - period.start.getTime(), 25 * 60 * 60 * 1000);
  });

  it("round-trips wall-clock hours", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const instant = zonedTimeToUtc(2026, 6, 15, hour, 30, 0, "Asia/Kolkata");
      const parts = zonedParts(instant, "Asia/Kolkata");
      assert.equal(parts.hour, hour);
      assert.equal(parts.day, 15);
    }
  });

  it("rejects an inverted or oversized range", () => {
    assert.throws(() => periodFromDates("2026-10-12", "2026-10-10", "UTC"));
    assert.throws(() => periodFromDates("2026-01-01", "2026-03-01", "UTC"));
  });

  it("schedules the next local slot and identifies a missed report day", () => {
    const now = new Date("2026-10-12T00:30:00.000Z");
    const next = nextScheduledInstant(now, "Asia/Kolkata", 7, 0);
    assert.equal(next.toISOString(), "2026-10-12T01:30:00.000Z");
    assert.equal(missedPeriodLabel(new Date("2026-10-12T05:10:00.000Z"), "Asia/Kolkata", 7, 30), "2026-10-11");
  });
});
