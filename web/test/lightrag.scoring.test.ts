// Local rerank primitives from lightrag.server.ts. These are pure and run with
// no LightRAG process anywhere near them.
//
// Assertions stay on the documented contract (stopwords / punctuation / case /
// short tokens for tokenize; term coverage and length normalisation for scoring)
// rather than on the exact stopword list or the exact BM25 constants, so tuning
// the reranker does not break the suite — only regressing its behaviour does.
import { describe, expect, it } from "vitest";
import { scoreSegment, tokenize } from "~/lib/lightrag.server";

// Padding that survives tokenisation and never collides with a query term.
function pad(n: number): string {
  return Array.from({ length: n }, () => "filler").join(" ");
}

describe("tokenize", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenize("Imagination Creates Reality")).toEqual([
      "imagination",
      "creates",
      "reality",
    ]);
  });

  it("removes stopwords", () => {
    expect(tokenize("the power of awareness")).toEqual(["power", "awareness"]);
    expect(tokenize("it is what it is")).toEqual([]);
  });

  it("drops one-character tokens", () => {
    // "a" and "i" are also stopwords, but "x" and "7" are not — length is the
    // rule that removes them.
    expect(tokenize("x 7 revision")).toEqual(["revision"]);
  });

  it("treats punctuation as a separator, not part of the word", () => {
    expect(tokenize("revision, imagination; and feeling!")).toEqual([
      "revision",
      "imagination",
      "feeling",
    ]);
    expect(tokenize("(SATS)")).toEqual(["sats"]);
    expect(tokenize("state—of—being")).toEqual(["state", "being"]);
    expect(tokenize("sats_session")).toEqual(["sats", "session"]);
  });

  it("splits contractions and possessives at the apostrophe", () => {
    const t = tokenize("Neville's teaching isn't a technique");
    expect(t).toContain("neville");
    expect(t).toContain("teaching");
    expect(t).toContain("technique");
    // The trailing "s" and "t" fragments are one character, so they are dropped.
    expect(t).not.toContain("s");
    expect(t).not.toContain("t");
  });

  it("handles curly apostrophes the same as straight ones", () => {
    expect(tokenize("Neville’s law")).toEqual(tokenize("Neville's law"));
  });

  it("keeps numbers, which carry the lecture years", () => {
    expect(tokenize("1952 lecture")).toEqual(["1952", "lecture"]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("\n\t\r")).toEqual([]);
    expect(tokenize("!!! ... ---")).toEqual([]);
  });

  it("returns nothing for non-string input instead of throwing", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(tokenize(bad as unknown as string)).toEqual([]);
    }
  });

  it("preserves order and repetition — the scorer needs term frequency", () => {
    expect(tokenize("wish wish fulfilled wish")).toEqual([
      "wish",
      "wish",
      "fulfilled",
      "wish",
    ]);
  });

  it("collapses runs of separators without emitting empty tokens", () => {
    const t = tokenize("imagination\n\n\n   ...   reality");
    expect(t).toEqual(["imagination", "reality"]);
    expect(t.every((x) => x.length > 1)).toBe(true);
  });

  it("strips non-ASCII letters rather than transliterating them", () => {
    // A known limitation, pinned so it is a decision and not a surprise: the
    // corpus is English, but an accented word loses its accented characters.
    expect(tokenize("révision")).toEqual(["vision"]);
    expect(tokenize("日本語")).toEqual([]);
  });
});

describe("scoreSegment", () => {
  const query = "imagination creates reality";

  it("scores zero when the query has no usable terms", () => {
    expect(scoreSegment("", "imagination creates reality")).toBe(0);
    expect(scoreSegment("the of and", "imagination creates reality")).toBe(0);
    expect(scoreSegment([], "imagination creates reality")).toBe(0);
  });

  it("scores zero for an empty segment", () => {
    expect(scoreSegment(query, "")).toBe(0);
    expect(scoreSegment(query, "!!!")).toBe(0);
  });

  it("scores zero when nothing in the segment matches", () => {
    expect(scoreSegment(query, "the harbour was full of fishing boats")).toBe(0);
  });

  it("scores a matching segment above zero", () => {
    expect(scoreSegment(query, "imagination creates reality")).toBeGreaterThan(0);
  });

  it("ranks a segment covering more query terms above one covering fewer", () => {
    // Same token length, so only term coverage differs.
    const three = "imagination creates reality now";
    const one = "imagination harbour fishing now";
    expect(tokenize(three)).toHaveLength(tokenize(one).length);
    expect(scoreSegment(query, three)).toBeGreaterThan(scoreSegment(query, one));
  });

  it("ranks coverage above raw repetition of a single term", () => {
    const covers = "imagination creates reality";
    const repeats = "imagination imagination imagination";
    expect(tokenize(covers)).toHaveLength(tokenize(repeats).length);
    expect(scoreSegment(query, covers)).toBeGreaterThan(scoreSegment(query, repeats));
  });

  it("penalises length so a long rambling passage cannot win on term count", () => {
    // The short one mentions each term once; the long one mentions a term six
    // times but buries it in 400 tokens of filler. The short one must win.
    const short = "imagination creates reality";
    const long = `${pad(400)} ${Array.from({ length: 6 }, () => "imagination").join(" ")}`;
    expect(scoreSegment(query, long)).toBeGreaterThan(0);
    expect(scoreSegment(query, short)).toBeGreaterThan(scoreSegment(query, long));
  });

  it("scores the same match lower as the surrounding passage grows", () => {
    const tight = `imagination ${pad(9)}`;
    const loose = `imagination ${pad(199)}`;
    const bloated = `imagination ${pad(1999)}`;
    const a = scoreSegment(query, tight);
    const b = scoreSegment(query, loose);
    const c = scoreSegment(query, bloated);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(0);
  });

  it("saturates term frequency instead of scaling linearly", () => {
    // Four occurrences in the same-length passage must score higher than one,
    // but nowhere near four times higher.
    const once = `imagination ${pad(39)}`;
    const fourTimes = `imagination imagination imagination imagination ${pad(36)}`;
    expect(tokenize(once)).toHaveLength(tokenize(fourTimes).length);
    const one = scoreSegment(query, once);
    const four = scoreSegment(query, fourTimes);
    expect(four).toBeGreaterThan(one);
    expect(four).toBeLessThan(4 * one);
  });

  it("accepts a raw string, a token array and a Set interchangeably", () => {
    const seg = "imagination creates the reality you assume";
    const fromString = scoreSegment(query, seg);
    const fromArray = scoreSegment(tokenize(query), seg);
    const fromSet = scoreSegment(new Set(tokenize(query)), seg);
    expect(fromArray).toBe(fromString);
    expect(fromSet).toBe(fromString);
  });

  it("counts each distinct query term once however often the query repeats it", () => {
    const seg = "imagination shapes imagination";
    expect(scoreSegment("imagination imagination imagination", seg)).toBe(
      scoreSegment("imagination", seg)
    );
  });

  it("matches regardless of case and punctuation on either side", () => {
    const plain = scoreSegment("imagination", "imagination is the only redemptive power");
    expect(scoreSegment("IMAGINATION!", "Imagination, is the only redemptive power.")).toBe(
      plain
    );
  });

  it("does not re-tokenize a pre-tokenized query, so stopwords in it match nothing", () => {
    // The segment side always tokenizes, which drops stopwords — so a caller
    // handing in raw stopwords gets 0 rather than a spurious match.
    expect(scoreSegment(["the"], "the the the the the")).toBe(0);
  });

  it("stays finite and non-negative on pathological input", () => {
    const cases = ["", "a", pad(5000), `${pad(5000)} imagination`, "imagination".repeat(50)];
    for (const seg of cases) {
      const s = scoreSegment(query, seg);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });
});
