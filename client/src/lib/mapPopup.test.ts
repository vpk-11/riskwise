import { describe, expect, it } from "vitest";
import { popupHTML } from "./mapPopup";

const hostile = {
  title: `<img src=x onerror="alert(1)">`,
  description: `<script>alert(2)</script> ${"x".repeat(200)}`,
  category: `Weather"><svg onload=alert(3)>`,
  severity: `High</span><iframe src=//evil>`,
  color: `red;background:url(javascript:alert(4))`,
};

describe("popupHTML", () => {
  it("contains no live markup from feed-derived values", () => {
    const html = popupHTML(hostile);
    for (const tag of ["<img", "<script", "<svg", "<iframe"]) expect(html.toLowerCase()).not.toContain(tag);
    expect(html).not.toContain("javascript:");
  });

  it("falls back to a safe color when the color prop is not a hex value", () => {
    expect(popupHTML(hostile)).toContain("#888");
  });

  it("renders normal values", () => {
    const html = popupHTML({ title: "Typhoon Koguma", description: "Storm near Shanghai", category: "Weather", severity: "High", color: "#e04040" });
    expect(html).toContain("Typhoon Koguma");
    expect(html).toContain("#e04040");
  });

  it("truncates long descriptions", () => {
    expect(popupHTML({ ...hostile, description: "Q".repeat(500) }).match(/Q+/)?.[0].length).toBe(130);
  });
});
