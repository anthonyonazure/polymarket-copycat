import { describe, expect, test } from "bun:test";
import { asList, asOptStr, asText, isJsonObject, pick, pickNum, pickOptStr, pickStr } from "./api.ts";

describe("JSON field readers keep the old `a || b || fallback` semantics", () => {
  const record = { proxyWallet: "", address: "0xABC", pnl: "12.5", profit: 3, nested: { a: 1 }, zero: 0 };

  test("pick skips falsy fields and returns the first truthy one", () => {
    expect(pick(record, "proxyWallet", "address")).toBe("0xABC");
    expect(pick(record, "zero", "missing")).toBeUndefined();
  });

  test("pickStr falls back when nothing usable is present, including nested objects", () => {
    expect(pickStr(record, ["proxyWallet", "address"])).toBe("0xABC");
    expect(pickStr(record, ["missing"], "unknown")).toBe("unknown");
    expect(pickStr(record, ["nested"], "?")).toBe("?");
    expect(pickOptStr(record, "missing")).toBeUndefined();
  });

  test("pickNum parses like parseFloat(x || 0)", () => {
    expect(pickNum(record, "pnl")).toBe(12.5);
    expect(pickNum(record, "missing", "profit")).toBe(3);
    expect(pickNum(record, "missing", "zero")).toBe(0);
    expect(pickNum({ size: "abc" }, "size")).toBeNaN();
    expect(pickNum(record, "nested")).toBeNaN();
  });

  test("asOptStr and asText keep strings, stringify scalars, drop objects", () => {
    expect(asOptStr("")).toBe("");
    expect(asOptStr(7)).toBe("7");
    expect(asOptStr(undefined)).toBeUndefined();
    expect(asOptStr({})).toBeUndefined();
    expect(asText(42, "?")).toBe("42");
    expect(asText(null, "?")).toBe("?");
  });
});

describe("asList", () => {
  test("accepts a bare array or the first truthy array field", () => {
    expect(asList([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(asList({ leaderboard: null, data: [{ b: 2 }] }, "leaderboard", "data")).toEqual([{ b: 2 }]);
    // An empty array is truthy, so `leaderboard || data` stops at it, as the JS original did.
    expect(asList({ leaderboard: [], data: [{ b: 2 }] }, "leaderboard", "data")).toEqual([]);
  });

  test("returns nothing for non-list responses and drops non-object entries", () => {
    expect(asList(null, "data")).toEqual([]);
    expect(asList({ data: "nope" }, "data")).toEqual([]);
    expect(asList([1, "x", { ok: true }, null])).toEqual([{ ok: true }]);
  });

  test("isJsonObject rejects arrays and null", () => {
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject({})).toBe(true);
  });
});
