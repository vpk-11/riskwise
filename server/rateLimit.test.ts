import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  it("allows up to the limit per key inside the window, then refuses", () => {
    const l = createRateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => l.allow("a", 0))).toEqual([true, true, true, false]);
    expect(l.allow("b", 0)).toBe(true);
  });

  it("allows again once the window has slid past old hits", () => {
    const l = createRateLimiter(1, 1000);
    expect(l.allow("a", 0)).toBe(true);
    expect(l.allow("a", 999)).toBe(false);
    expect(l.allow("a", 1000)).toBe(true);
  });

  it("does not count refused calls against the key", () => {
    const l = createRateLimiter(1, 1000);
    l.allow("a", 0);
    for (let i = 0; i < 5; i++) l.allow("a", 500);
    expect(l.allow("a", 1000)).toBe(true);
  });

  it("limit 0 disables the limiter", () => {
    const l = createRateLimiter(0, 1000);
    expect(Array.from({ length: 50 }, () => l.allow("a", 0)).every(Boolean)).toBe(true);
  });

  it("drops expired keys so memory does not grow with distinct clients", () => {
    const l = createRateLimiter(5, 1000);
    for (let i = 0; i < 10_001; i++) l.allow(`ip-${i}`, 0);
    expect(l.size()).toBe(10_001);
    l.allow("fresh", 5000);
    expect(l.size()).toBe(1);
  });
});
