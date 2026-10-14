import { describe, expect, it } from "vitest";
import { escapeHtml, getRiskColor, getRiskLabel, getRiskLevel, getSeverityColor, toMapColor } from "./riskUtils";

describe("risk score thresholds", () => {
  it("labels 0-30 low, 31-60 moderate, 61-75 high, 76+ critical", () => {
    expect(getRiskLabel(0)).toBe("LOW RISK");
    expect(getRiskLabel(30)).toBe("LOW RISK");
    expect(getRiskLabel(31)).toBe("MODERATE RISK");
    expect(getRiskLabel(60)).toBe("MODERATE RISK");
    expect(getRiskLabel(61)).toBe("HIGH RISK");
    expect(getRiskLabel(75)).toBe("HIGH RISK");
    expect(getRiskLabel(76)).toBe("CRITICAL RISK");
    expect(getRiskLabel(100)).toBe("CRITICAL RISK");
  });

  it("level and label agree at every boundary", () => {
    const levelToLabel = { low: "LOW RISK", medium: "MODERATE RISK", high: "HIGH RISK", critical: "CRITICAL RISK" };
    for (const score of [0, 30, 31, 60, 61, 75, 76, 100]) {
      expect(getRiskLabel(score)).toBe(levelToLabel[getRiskLevel(score)]);
    }
  });

  it("uses one color per band", () => {
    expect(getRiskColor(30)).toBe(getRiskColor(0));
    expect(getRiskColor(31)).not.toBe(getRiskColor(30));
    expect(getRiskColor(60)).toBe(getRiskColor(31));
    expect(getRiskColor(61)).not.toBe(getRiskColor(60));
    expect(getRiskColor(100)).toBe(getRiskColor(61));
  });
});

describe("toMapColor", () => {
  it("converts known oklch values", () => {
    expect(toMapColor("oklch(1 0 0)")).toBe("#ffffff");
    expect(toMapColor("oklch(0 0 0)")).toBe("#000000");
    // sRGB red in oklch
    expect(toMapColor("oklch(0.628 0.2577 29.23)")).toBe("#ff0000");
  });

  it("returns a hex color for every color the map uses", () => {
    for (const score of [0, 50, 90]) expect(toMapColor(getRiskColor(score))).toMatch(/^#[0-9a-f]{6}$/);
    for (const sev of ["Low", "Medium", "High", "Critical", "other"]) {
      expect(toMapColor(getSeverityColor(sev))).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("leaves non-oklch strings unchanged", () => {
    expect(toMapColor("#abcdef")).toBe("#abcdef");
  });
});

describe("escapeHtml", () => {
  it("neutralizes markup so feed text cannot run script in the popup", () => {
    const hostile = `<img src=x onerror="alert(1)"> & 'quoted'`;
    const out = escapeHtml(hostile);
    expect(out).not.toMatch(/[<>"]/);
    expect(out).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;");
  });
  it("leaves plain text unchanged", () => {
    expect(escapeHtml("Typhoon Koguma 58 km")).toBe("Typhoon Koguma 58 km");
  });
});
