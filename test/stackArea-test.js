import assert from "node:assert";
import {it} from "vitest";
import {
  stack,
  stackArea,
  stackAreaPath,
  stackOffsetDiverging,
  stackOffsetDivergingGap,
  stackOrderNone,
  stackOrderReverse
} from "d3-shape";
import {assertInDelta, assertPathEqual} from "./asserts.js";

// A minimal CanvasRenderingContext2D stand-in that records the path it is asked
// to draw, so direct rendering can be compared with the exported SVG path.
function recordingContext() {
  const ops = [];
  return {
    moveTo(x, y) { ops.push(`M${x},${y}`); },
    lineTo(x, y) { ops.push(`L${x},${y}`); },
    closePath() { ops.push("Z"); },
    toString() { return ops.join(""); }
  };
}

// The fill region of a band at a given x, as [lower, upper]: both edges are
// piecewise linear between vertices, so interpolate inside the edge that spans
// x. Returns null when no band covers x.
function crossSection(series, x) {
  for (const band of series) {
    if (x < band.x0 - 1e-9 || x > band.x1 + 1e-9) continue;
    return [interp(band.bottom, x), interp(band.top, x)];
  }
  return null;
}

function interp(edge, x) {
  for (let i = 0; i + 1 < edge.length; ++i) {
    const [x0, y0] = edge[i], [x1, y1] = edge[i + 1];
    if ((x0 <= x && x <= x1) || (x1 <= x && x <= x0)) {
      return x1 === x0 ? y0 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  // x coincides with the last vertex.
  return edge[edge.length - 1][1];
}

// The example fixed by the specification: two columns a unit apart, centered gap
// of width 4, bands A, B, C stacked outward in that order. A runs 3 → −1, B runs
// −1 → 3, and C is a steady 2, so B reaches zero at x = 1/4 and A at x = 3/4.
const specData = [
  {x: 0, A: 3, B: -1, C: 2},
  {x: 1, A: -1, B: 3, C: 2}
];

function specStack() {
  return stackArea().keys(["A", "B", "C"]).x((d) => d.x).gap(4);
}

it("stackArea() has the expected defaults", () => {
  const a = stackArea();
  assert.deepStrictEqual(a.keys()(), []);
  assert.strictEqual(a.value()({foo: 42}, "foo"), 42);
  assert.strictEqual(a.order(), stackOrderNone);
  assert.strictEqual(a.x()({}, 7), 7); // defaults to the column index
  assert.strictEqual(a.defined()({}, 0), true);
  assert.strictEqual(a.gap(), 0);
});

it("stackArea.keys(array) and keys(function) set the categories", () => {
  assert.deepStrictEqual(stackArea().keys(["a", "b"]).keys()(), ["a", "b"]);
  const f = () => ["x", "y"];
  assert.strictEqual(stackArea().keys(f).keys(), f);
});

it("stackArea.value sets the value accessor and coerces to a number", () => {
  const v = (d, k) => d[k];
  assert.strictEqual(stackArea().value(v).value(), v);
  const series = stackArea().keys(["foo"]).value(v).gap(0)([{foo: "2.0"}, {foo: "2.0"}]);
  // Only one category, positive, so its band runs from 0 to 2 over [0, 1].
  assert.strictEqual(series.length, 1);
  assert.strictEqual(series[0].key, "foo");
  assertInDelta(crossSection(series[0], 0.5), [0, 2]);
  // The value is coerced to a number before being stacked.
  assertInDelta(series[0][0].top, [[0, 2], [1, 2]]);
});

it("stackArea(data) returns one series per key, in key order, with draw indices recorded separately", () => {
  const series = specStack().order(stackOrderReverse)(specData);
  // Return order follows keys(), not the draw order…
  assert.deepStrictEqual(series.map((s) => s.key), ["A", "B", "C"]);
  // …while .index gives each category’s position in the draw order.
  assert.deepStrictEqual(series.map((s) => s.index), [2, 1, 0]);
  // The input rows are not mutated and each series carries its own key.
  assert.deepStrictEqual(specData, [
    {x: 0, A: 3, B: -1, C: 2},
    {x: 1, A: -1, B: 3, C: 2}
  ]);
});

it("stackArea band thickness equals the absolute value at any cross-section", () => {
  const series = specStack()(specData);
  for (const x of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
    for (const s of series) {
      const expected = Math.abs(s.key === "A"
          ? 3 + (-1 - 3) * x
          : s.key === "B"
          ? -1 + (3 + 1) * x
          : 2);
      const cut = crossSection(s, x);
      if (expected < 1e-9) {
        // A band that has tapered to zero has no visible thickness here.
        if (cut) assertInDelta(cut[1] - cut[0], 0);
        continue;
      }
      assert(cut, `expected ${s.key} to cover x=${x}`);
      assertInDelta(cut[1] - cut[0], expected);
    }
  }
});

it("stackArea puts the two sides the same distance from zero, stacking outward in draw order", () => {
  const series = specStack()(specData);
  const byKey = Object.fromEntries(series.map((s) => [s.key, s]));

  // At x=0: A = 3 (positive, first), B = -1 (negative, first), C = 2 (positive, second).
  // Positive gap edge is +2 and negative gap edge is -2.
  assertInDelta(crossSection(byKey.A, 0), [2, 5]);
  assertInDelta(crossSection(byKey.C, 0), [5, 7]);
  assertInDelta(crossSection(byKey.B, 0), [-3, -2]);

  // At x=1 the signs swap for A and B: A is now negative and B positive.
  assertInDelta(crossSection(byKey.A, 1), [-3, -2]);
  assertInDelta(crossSection(byKey.B, 1), [2, 5]);
  assertInDelta(crossSection(byKey.C, 1), [5, 7]);
});

it("stackArea makes a neighbor follow the real boundary when another category crosses zero", () => {
  // C never changes side (always 2), yet its inner edge is pushed out by A and B
  // while they are positive and pulled back once they cross zero. The fixed
  // expectation from the specification is 4.5 at x=1/8, 4 at x=1/2, 4.5 at x=7/8.
  const c = specStack()(specData).find((s) => s.key === "C");
  assertInDelta(crossSection(c, 1 / 8), [4.5, 6.5]);
  assertInDelta(crossSection(c, 1 / 2), [4, 6]);
  assertInDelta(crossSection(c, 7 / 8), [4.5, 6.5]);
  // The flat end points (5) do not hide the inward notch in between.
  assertInDelta(crossSection(c, 0), [5, 7]);
  assertInDelta(crossSection(c, 1), [5, 7]);
  assert(c[0].bottom.some((p) => Math.abs(p[0] - 0.25) < 1e-9 && Math.abs(p[1] - 4) < 1e-9));
});

it("stackArea never fills across the gap when a category changes side", () => {
  const series = specStack()(specData);
  for (const s of series) {
    for (const x of [0, 0.1, 0.24, 0.26, 0.5, 0.74, 0.76, 0.9, 1]) {
      const cut = crossSection(s, x);
      if (!cut) continue;
      // No band may straddle the center gap (between -2 and 2).
      assert(cut[1] <= -2 + 1e-9 || cut[0] >= 2 - 1e-9,
          `${s.key} at x=${x} fills [${cut}] across the gap`);
    }
  }
});

it("stackArea splits a band into separate positive and negative pieces at its zero crossings", () => {
  const series = specStack()(specData);
  const byKey = Object.fromEntries(series.map((s) => [s.key, s]));
  // A is positive on [0, 3/4] and negative on [3/4, 1].
  assert.deepStrictEqual(byKey.A.map((b) => b.sign), [1, -1]);
  assertInDelta(byKey.A[0].x1, 0.75);
  assertInDelta(byKey.A[1].x0, 0.75);
  // B is the reverse.
  assert.deepStrictEqual(byKey.B.map((b) => b.sign), [-1, 1]);
  // C never changes side, so it stays a single band.
  assert.deepStrictEqual(byKey.C.map((b) => b.sign), [1]);
});

it("stackArea.gap(0) meets the two sides at zero, matching stackOffsetDiverging endpoints", () => {
  const rows = [[3, -1, 2], [-1, 3, 2]];
  const keys = [0, 1, 2];
  const series = stackArea().keys(keys).x((d, i) => i).gap(0)(rows);

  // Reference endpoints from the existing diverging offset.
  const reference = stack().keys(keys).offset(stackOffsetDiverging)(rows);

  for (let i = 0; i < keys.length; ++i) {
    for (let j = 0; j < rows.length; ++j) {
      const band = series[i].find((b) =>
          b.x0 - 1e-9 <= j && j <= b.x1 + 1e-9);
      if (!band) {
        // Zero thickness: the reference collapses to a point at zero.
        assertInDelta(reference[i][j], [0, 0]);
        continue;
      }
      const cut = crossSection(series[i], j);
      assertInDelta(cut, reference[i][j]);
    }
  }
});

it("stackArea.gap(null) and a non-positive gap behave like gap(0)", () => {
  for (const g of [null, 0, -4]) {
    const series = stackArea().keys(["A", "B", "C"]).x((d) => d.x).gap(g)(specData);
    assert.strictEqual(stackArea().gap(g).gap(), g == null ? 0 : g);
    const a = series.find((s) => s.key === "A");
    // With no gap A’s positive band starts at zero.
    assertInDelta(crossSection(a, 0), [0, 3]);
  }
});

it("stackArea keeps a valid zero as a place where a band disappears and reappears", () => {
  const data = [
    {x: 0, A: 2, B: 1},
    {x: 1, A: 0, B: 1},
    {x: 2, A: 2, B: 1}
  ];
  const series = stackArea().keys(["A", "B"]).x((d) => d.x).gap(4)(data);
  const a = series.find((s) => s.key === "A");
  // A tapers to nothing at the middle column and comes back, on the same side.
  const pieces = a.filter((b) => b.sign > 0);
  assert.strictEqual(pieces.length, 2);
  assertInDelta(pieces[0].x1, 1);
  assertInDelta(pieces[1].x0, 1);
  assertInDelta(crossSection([pieces[0]], 0.5), [2, 3]);
  // B, unaffected, still spans the whole domain on the positive side.
  const b = series.find((s) => s.key === "B");
  assert.strictEqual(b.length, 1);
  assertInDelta([b[0].x0, b[0].x1], [0, 2]);
});

it("stackArea breaks only the missing category’s contour; the others keep their valid intervals", () => {  const data = [
    {x: 0, A: 2, B: 1, C: 1},
    {x: 1, A: null, B: 2, C: 1},
    {x: 2, A: 2, B: 3, C: 1}
  ];
  const series = stackArea().keys(["A", "B", "C"]).x((d) => d.x).gap(4)(data);
  const byKey = Object.fromEntries(series.map((s) => [s.key, s]));
  // A missing at x=1 leaves no A band at all (neither interval is complete).
  assert.strictEqual(byKey.A.length, 0);
  // B and C remain single continuous bands across the full domain.
  for (const key of ["B", "C"]) {
    assert.strictEqual(byKey[key].length, 1, `${key} should not break`);
    assertInDelta([byKey[key][0].x0, byKey[key][0].x1], [0, 2]);
  }
});

it("stackArea moves a neighbor’s edge vertically where a category appears or disappears", () => {
  // A is missing at x=0 and present from x=1. Draw order A then B, so B sits
  // outward of A: where A appears, B’s inner edge must jump from the gap edge
  // (2) to just above A (2 + 3 = 5), giving a genuine vertical edge at x=1.
  const data = [
    {x: 0, A: null, B: 2},
    {x: 1, A: 3, B: 2},
    {x: 2, A: 3, B: 2}
  ];
  const series = stackArea().keys(["A", "B"]).x((d) => d.x).gap(4)(data);
  const byKey = Object.fromEntries(series.map((s) => [s.key, s]));
  assert.deepStrictEqual(byKey.A.map((b) => [b.x0, b.x1]), [[1, 2]]);
  const b = byKey.B[0];
  // Left of x=1 B hugs the gap; right of x=1 it sits on top of A.
  assertInDelta(crossSection([b], 0.5), [2, 4]);
  assertInDelta(crossSection([b], 1.5), [5, 7]);
  // The vertical jump is encoded at x=1, spanning 2 → 5 on the lower edge.
  const atOne = b.bottom.filter((p) => Math.abs(p[0] - 1) < 1e-9).map((p) => p[1]).sort((p, q) => p - q);
  assert.deepStrictEqual(atOne, [2, 5]);
});

it("stackArea treats a category missing over an interior interval as absent there only", () => {
  const data = [
    {x: 0, A: 2, B: 1},
    {x: 1, A: 3, B: 1},
    {x: 2, A: null, B: 1},
    {x: 3, A: 2, B: 1},
    {x: 4, A: 4, B: 1}
  ];
  const series = stackArea().keys(["A", "B"]).x((d) => d.x).gap(4)(data);
  const byKey = Object.fromEntries(series.map((s) => [s.key, s]));
  // A has a piece before and after the gap, but none over [1, 3] or [3, 4]…
  const pieces = byKey.A.filter((b) => b.sign > 0);
  assert.strictEqual(pieces.length, 2);
  assertInDelta([pieces[0].x0, pieces[0].x1], [0, 1]);
  assertInDelta([pieces[1].x0, pieces[1].x1], [3, 4]);
  // …whereas B runs straight through.
  assert.strictEqual(byKey.B.length, 1);
  assertInDelta([byKey.B[0].x0, byKey.B[0].x1], [0, 4]);
  // The missing A does not leave a hole in B’s thickness.
  for (const x of [1.5, 2.5, 3.5]) {
    const cut = crossSection(byKey.B, x);
    assertInDelta(cut[1] - cut[0], 1);
  }
});

it("stackArea honors a custom value accessor and defined predicate", () => {
  const data = [
    {x: 0, v: {p: 2}, ok: true},
    {x: 1, v: {p: -2}, ok: true},
    {x: 2, v: {p: 2}, ok: false}
  ];
  const series = stackArea()
      .keys(["p"])
      .x((d) => d.x)
      .value((d, k) => d.v[k])
      .defined((d) => d.ok)
      .gap(2)(data);
  const p = series[0];
  // Only the first interval (both endpoints ok) is drawn; it changes sign at 1/2.
  assert.deepStrictEqual(p.map((b) => b.sign), [1, -1]);
  assertInDelta([p[0].x0, p[0].x1], [0, 0.5]);
  assertInDelta([p[1].x0, p[1].x1], [0.5, 1]);
});

it("stackArea passes the value and x accessors the datum, index and data; defined gets the datum, index and data", () => {
  const calls = [];
  const data = [{x: 0, A: 1}, {x: 1, A: 2}];
  const s = stackArea()
      .keys(["A"])
      .x(function() { calls.push(["x", ...arguments]); return arguments[0].x; })
      .value(function() { calls.push(["value", ...arguments]); return arguments[0].A; })
      .defined(function() { calls.push(["defined", ...arguments]); return true; });
  s(data, "extra");
  const xCalls = calls.filter((c) => c[0] === "x");
  assert.deepStrictEqual(xCalls.map((c) => [c[1], c[2]]).sort(), [[data[0], 0], [data[1], 1]]);
  const vCalls = calls.filter((c) => c[0] === "value");
  // The value accessor receives datum, key, index and the full data array.
  assert.deepStrictEqual(vCalls[0].slice(1, 4), [data[0], "A", 0]);
  assert.strictEqual(vCalls[0][4], data);
  assert(calls.some((c) => c[0] === "defined" && c[1] === data[0] && c[2] === 0 && c[3] === data));
});

it("stackArea.order accepts an array of key positions", () => {
  const series = stackArea()
      .keys(["A", "B", "C"])
      .x((d) => d.x)
      .gap(0)
      .order([2, 0, 1])(specData);
  // The array gives draw positions: each entry is a series index, in draw order.
  // With [2, 0, 1], key C draws first, then A, then B.
  assert.deepStrictEqual(series.map((s) => s.index), [1, 2, 0]);
});

it("stackArea works when x decreases from column to column", () => {
  // The same geometry with the columns supplied right-to-left must still produce
  // closed contours with the same fill regions, just ordered by the given x.
  const series = stackArea().keys(["A", "B"])
      .x((d) => d.x).gap(4)([
        {x: 1, A: 3, B: -1},
        {x: 0, A: -1, B: 3}
      ]);
  for (const s of series) {
    assert(s.length > 0, `${s.key} should have at least one band`);
    for (const b of s) {
      assert(b.x0 < b.x1, "band vertices are ordered by increasing x");
      // Every band stays on one side of the gap.
      const lo = Math.min(...b.bottom.map((p) => p[1]));
      const hi = Math.max(...b.top.map((p) => p[1]));
      assert(hi <= -2 + 1e-9 || lo >= 2 - 1e-9, `${s.key} band straddles the gap`);
    }
  }
  const byKey = Object.fromEntries(series.map((s) => [s.key, s]));
  // Both appear from x=0 to x=1 with A on the positive side and B above it.
  assertInDelta(crossSection(byKey.A, 0.5), [2, 3]);
  assertInDelta(crossSection(byKey.B, 0.5), [3, 4]);
});

it("stackArea returns no bands for a single column or no columns", () => {
  assert.deepStrictEqual(stackArea().keys(["A"]).gap(4)([{x: 0, A: 1}]).map((s) => s.length), [0]);
  assert.deepStrictEqual(stackArea().keys(["A"]).gap(4)([]).map((s) => s.length), [0]);
  assert.deepStrictEqual(stackArea().keys([])([{x: 0}]), []);
});

it("stackAreaPath renders each band as one closed subpath following its vertices", () => {
  const series = specStack()(specData);
  const band = series.find((s) => s.key === "C")[0];
  const d = stackAreaPath()(series.find((s) => s.key === "C")) + "";
  // One band, so exactly one closed subpath.
  assert.strictEqual(d.split("Z").filter(Boolean).length, 1);
  assert(d.endsWith("Z"));
  // The path is the band’s polygon: top edge left-to-right, then the bottom edge
  // right-to-left, then closed. Coordinates round to three digits by default.
  const expected = band.map((p, i) => `${i === 0 ? "M" : "L"}${round(p[0])},${round(p[1])}`).join("") + "Z";
  assertPathEqual(d, expected);
});

function round(v) {
  return Math.round(v * 1000) / 1000;
}

it("stackAreaPath emits one subpath per band and matches direct rendering", () => {
  const series = specStack()(specData);
  for (const s of series) {
    const exported = stackAreaPath()(s) + "";
    assert.strictEqual(exported.split("Z").filter(Boolean).length, s.length);
    const context = recordingContext();
    stackAreaPath().context(context)(s);
    assertPathEqual(context + "", exported);
  }
});

it("stackAreaPath observes x, y and digits accessors", () => {
  const series = specStack()(specData);
  const scaled = stackAreaPath()
      .x(([px]) => px * 10)
      .y(([, py]) => py * 10);
  const d = scaled(series.find((s) => s.key === "C"));
  const first = series.find((s) => s.key === "C")[0].top[0];
  assert(d.startsWith(`M${first[0] * 10},${first[1] * 10}`));
  assert.strictEqual(stackAreaPath().digits(), 3);
  assert.throws(() => stackAreaPath().digits(-1), /invalid digits/);
});

it("stackOffsetDivergingGap(0) matches stackOffsetDiverging exactly", () => {
  const rows = [[3, -1, 2], [-1, 3, 2], [1, 0, -2]];
  const strip = (series) => series.map((s) => s.map((p) => p.map((v) => v === 0 ? 0 : v)));
  const run = (offset) => strip(stack().keys([0, 1, 2]).offset(offset)(rows));
  assert.deepStrictEqual(run(stackOffsetDivergingGap(0)), run(stackOffsetDiverging));
});

it("stackOffsetDivergingGap(gap) starts both sides the same distance from zero", () => {
  const rows = [[3, -1, 2], [-1, 3, 2]];
  const series = stack().keys([0, 1, 2]).offset(stackOffsetDivergingGap(4))(rows);
  // Positive bands start at +2, negative bands end at −2.
  assertInDelta(series[0][0], [2, 5]); // 3 > 0, first positive
  assertInDelta(series[1][0], [-3, -2]); // −1 < 0, first negative
  assertInDelta(series[2][0], [5, 7]); // 2 > 0, second positive
});

it("stackOffsetDivergingGap preserves series identity and draw order", () => {
  const rows = [[3, -1, 2], [-1, 3, 2]];
  const series = stack().keys([0, 1, 2]).order(stackOrderReverse)
      .offset(stackOffsetDivergingGap(4))(rows);
  // The returned array is still in key order; only .index reflects draw order.
  assert.deepStrictEqual(series.map((s) => s.key), [0, 1, 2]);
  assert.deepStrictEqual(series.map((s) => s.index), [2, 1, 0]);
  // With key 2 drawn first, its positive band starts at the gap edge.
  assertInDelta(series[2][0], [2, 4]);
});

it("stackOffsetDivergingGap measures thickness as the difference of existing endpoints", () => {
  // Points that already carry an offset [lo, hi]; thickness is hi - lo, which is
  // not the same as hi when lo is nonzero. Both categories are positive.
  const series = [
    [[10, 12], [20, 23]], // thickness 2, 3
    [[-5, -2], [-9, -4]] // thickness 3, 5
  ];
  stackOffsetDivergingGap(4)(series, stackOrderNone(series));
  assertInDelta(series, [
    [[2, 4], [2, 5]],
    [[4, 7], [5, 10]]
  ]);
});

it("stackOffsetDivergingGap leaves zero thickness at zero and NaN at NaN", () => {
  const series = [[[0, 1], [0, NaN]], [[0, 0], [0, 2]]];
  stackOffsetDivergingGap(4)(series, stackOrderNone(series));
  // The first category is positive (1) at column 0; the second is a valid zero,
  // so it stays [0, 0] and does not push the first band.
  assertInDelta([series[0][0], series[1][0]], [[2, 3], [0, 0]]);
  // A NaN upper bound is preserved, with a zero lower bound.
  assert(isNaN(series[0][1][1]));
  assert.strictEqual(series[0][1][0], 0);
});
