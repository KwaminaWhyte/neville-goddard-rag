// Login throttling curve and the pgvector literal encoder — the two remaining
// pure helpers in db.server.ts. Both are small but both sit on a security or
// data-integrity boundary, so their edges are worth pinning down.
import { describe, expect, it } from "vitest";
import { backoffSeconds, toVectorLiteral } from "~/lib/db.server";

const FREE_ATTEMPTS = 5;
const MAX_BACKOFF = 900;

describe("backoffSeconds", () => {
  it("charges nothing up to and including the free-attempt threshold", () => {
    for (let f = 0; f <= FREE_ATTEMPTS; f++) {
      expect(backoffSeconds(f), `failures=${f}`).toBe(0);
    }
  });

  it("starts charging on the first failure past the threshold", () => {
    expect(backoffSeconds(FREE_ATTEMPTS + 1)).toBe(5);
  });

  it("doubles per extra failure", () => {
    expect(backoffSeconds(6)).toBe(5);
    expect(backoffSeconds(7)).toBe(10);
    expect(backoffSeconds(8)).toBe(20);
    expect(backoffSeconds(9)).toBe(40);
    expect(backoffSeconds(10)).toBe(80);
    expect(backoffSeconds(11)).toBe(160);
    expect(backoffSeconds(12)).toBe(320);
    expect(backoffSeconds(13)).toBe(640);
  });

  it("saturates at the cap instead of growing without bound", () => {
    // 14 failures would be 1280s uncapped.
    expect(backoffSeconds(14)).toBe(MAX_BACKOFF);
    expect(backoffSeconds(15)).toBe(MAX_BACKOFF);
    expect(backoffSeconds(100)).toBe(MAX_BACKOFF);
    expect(backoffSeconds(1_000_000)).toBe(MAX_BACKOFF);
    expect(backoffSeconds(Number.MAX_SAFE_INTEGER)).toBe(MAX_BACKOFF);
  });

  it("is never negative and never exceeds the cap", () => {
    for (let f = -10; f <= 200; f++) {
      const v = backoffSeconds(f);
      expect(v, `failures=${f}`).toBeGreaterThanOrEqual(0);
      expect(v, `failures=${f}`).toBeLessThanOrEqual(MAX_BACKOFF);
      expect(Number.isFinite(v), `failures=${f}`).toBe(true);
    }
  });

  it("is monotonically non-decreasing", () => {
    let prev = -1;
    for (let f = 0; f <= 60; f++) {
      const v = backoffSeconds(f);
      expect(v, `failures=${f}`).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("treats a negative or zero count as no penalty", () => {
    // A counting bug upstream must fail closed to "no lockout", not produce a
    // negative retry-after that a client would read as "retry immediately".
    expect(backoffSeconds(-1)).toBe(0);
    expect(backoffSeconds(-1000)).toBe(0);
    expect(backoffSeconds(0)).toBe(0);
  });

  it("stays finite for Infinity", () => {
    expect(backoffSeconds(Infinity)).toBe(MAX_BACKOFF);
  });
});

describe("toVectorLiteral", () => {
  it("emits the pgvector bracketed form", () => {
    expect(toVectorLiteral([1, 2, 3])).toBe("[1,2,3]");
  });

  it("emits brackets with no contents for an empty embedding", () => {
    expect(toVectorLiteral([])).toBe("[]");
  });

  it("keeps signs and decimals", () => {
    expect(toVectorLiteral([0.1, -0.2, 0])).toBe("[0.1,-0.2,0]");
    expect(toVectorLiteral([-0])).toBe("[0]");
  });

  it("never inserts spaces — pgvector's parser wants a bare comma list", () => {
    const lit = toVectorLiteral([0.123456789, 1e-7, 2.5]);
    expect(lit).not.toMatch(/\s/);
    expect(lit.startsWith("[")).toBe(true);
    expect(lit.endsWith("]")).toBe(true);
  });

  it("uses JS number formatting, including exponent notation", () => {
    // Worth pinning: pgvector accepts "1e-7", so this is fine, but the encoder
    // is not doing any formatting of its own and a change here would be silent.
    expect(toVectorLiteral([1e-7])).toBe("[1e-7]");
    expect(toVectorLiteral([1e21])).toBe("[1e+21]");
  });

  it("produces one element per dimension so the dim column cannot drift", () => {
    const emb = Array.from({ length: 768 }, (_, i) => i / 1000);
    const lit = toVectorLiteral(emb);
    expect(lit.slice(1, -1).split(",")).toHaveLength(emb.length);
  });

  // The signature says number[] but nothing enforces it at runtime, and a
  // half-failed embedding call can yield NaN. Rejecting at this choke point
  // keeps garbage out of the table instead of deferring to a Postgres cast
  // error — every caller binds the result as `$n::vector`.
  it("rejects a smuggled non-number rather than emitting it verbatim", () => {
    const hostile = ["1", "2); DROP TABLE neville_entry_embeddings; --"] as unknown as number[];
    expect(() => toVectorLiteral(hostile)).toThrow(/non-finite value at index 0/);
  });

  it("rejects non-finite values and names the offending index", () => {
    expect(() => toVectorLiteral([NaN])).toThrow(/index 0/);
    expect(() => toVectorLiteral([0.1, Infinity])).toThrow(/index 1/);
    expect(() => toVectorLiteral([0.1, 0.2, -Infinity])).toThrow(/index 2/);
  });

  it("still accepts every finite value, including the extremes", () => {
    expect(toVectorLiteral([0, -0, 1e-7, 1e21, Number.MAX_VALUE])).toContain("[0,0,1e-7,1e+21,");
  });
});
