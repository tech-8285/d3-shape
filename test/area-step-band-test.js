import assert from "node:assert";
import {it} from "vitest";
import {area, curveStepAfter, curveStepBefore} from "d3-shape";
import {assertInDelta, assertPathEqual} from "./asserts.js";

// Integration tests for the difference-band pipeline: two survey lines
// sampled at the same stations, with the fill between them encoding the
// difference of the two readings. A missing reading splits the band into
// disconnected pieces. Geometric expectations below are derived from the
// raw series and the chosen step rule (jump at interval start vs. end).
const stations = [
  {x: 0, a: 4, b: 1},
  {x: 1, a: 3, b: 2},
  {x: 2, a: null, b: null}, // missing reading: the band breaks here
  {x: 3, a: 1, b: 3},
  {x: 4, a: 2, b: 4}
];

function band(curve, swap) {
  return area()
      .x((d) => d.x)
      .y0((d) => swap ? d.a : d.b)
      .y1((d) => swap ? d.b : d.a)
      .defined((d) => d.a != null && d.b != null)
      .curve(curve);
}

// A minimal stand-in for a CanvasRenderingContext2D that records the path
// it is asked to draw, so direct rendering can be compared with the
// exported vector path (the SVG path string).
function recordingContext() {
  const ops = [];
  return {
    moveTo(x, y) { ops.push(`M${x},${y}`); },
    lineTo(x, y) { ops.push(`L${x},${y}`); },
    closePath() { ops.push("Z"); },
    toString() { return ops.join(""); }
  };
}

// Splits an SVG path string into one point list per closed subpath.
function subpaths(d) {
  return d.split("Z")
      .filter(Boolean)
      .map((s) => s.slice(1).split("L").map((p) => p.split(",").map(Number)));
}

// Signed area via the shoelace formula; the sign gives the winding.
function signedArea(points) {
  let sum = 0;
  for (let i = 0, n = points.length; i < n; ++i) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % n];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

it("step band: with curveStepBefore both edges of each piece jump at the start of every interval", () => {
  // Piece 1 (a above b): the top edge jumps at x=0 from 4 to 3 and holds 3
  // over [0,1]; the bottom edge is drawn in reverse yet, interpreted in the
  // original observation direction, also jumps at x=0 from 1 to 2 and holds
  // 2 over [0,1]. Piece 2 (b above a) follows the same rule over [3,4].
  assertPathEqual(band(curveStepBefore)(stations),
      "M0,4L0,3L1,3L1,2L0,2L0,1Z" +
      "M3,1L3,2L4,2L4,4L3,4L3,3Z");
});

it("step band: with curveStepAfter both edges of each piece jump at the end of every interval", () => {
  // Piece 1: the top edge holds 4 over [0,1] and jumps at x=1 down to 3;
  // the reversed bottom edge, read in the original direction, holds 1 over
  // [0,1] and jumps at x=1 up to 2. Piece 2 follows the same rule.
  assertPathEqual(band(curveStepAfter)(stations),
      "M0,4L1,4L1,3L1,2L1,1L0,1Z" +
      "M3,1L4,1L4,2L4,4L4,3L3,3Z");
});

it("step band: the fill of each piece spans exactly the x-range its valid intervals occupy", () => {
  for (const curve of [curveStepBefore, curveStepAfter]) {
    const pieces = subpaths(band(curve)(stations) + "");
    assert.strictEqual(pieces.length, 2); // the gap cuts the band into two pieces
    const extents = pieces.map((points) => [
      Math.min(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[0]))
    ]);
    // Valid intervals are [0,1] and [3,4]; nothing is filled over the gap (1,3).
    assertInDelta(extents, [[0, 1], [3, 4]]);
    // Jumps (vertical segments, including the closing edge) only occur at
    // interval endpoints, never mid-interval: each edge is a genuine
    // staircase over the occupied range.
    const jumpXs = pieces.map((points) => {
      const xs = [];
      for (let i = 0, n = points.length; i < n; ++i) {
        const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % n];
        if (x0 === x1 && y0 !== y1) xs.push(x0);
      }
      return [...new Set(xs)].sort((p, q) => p - q);
    });
    assertInDelta(jumpXs, [[0, 1], [3, 4]]);
  }
});

it("step band: swapping the two survey lines flips the winding but each oppositely-oriented piece keeps a visible area", () => {
  for (const curve of [curveStepBefore, curveStepAfter]) {
    const normal = subpaths(band(curve)(stations) + "").map(signedArea);
    const swapped = subpaths(band(curve, true)(stations) + "").map(signedArea);
    assert.strictEqual(normal.length, 2);
    assert.strictEqual(swapped.length, 2);
    // The two pieces wind in opposite directions: a is above b on the first
    // piece and below it on the second.
    assert(normal[0] * normal[1] < 0, `pieces should wind oppositely, got ${normal}`);
    // After swapping high/low, each region keeps its (visible) area and
    // reverses its orientation.
    for (let i = 0; i < 2; ++i) {
      assert(Math.abs(normal[i]) > 0, `piece ${i} should have visible area`);
      assertInDelta(swapped[i], -normal[i]);
      assert(Math.abs(swapped[i]) > 0, `swapped piece ${i} should still have visible area`);
    }
  }
});

it("step band: each piece closes on both sides of the gap, and direct rendering matches the exported vector path", () => {
  for (const curve of [curveStepBefore, curveStepAfter]) {
    const b = band(curve);
    const exported = b(stations) + "";

    // Every piece is closed: the gap does not leak open contours.
    const pieces = exported.split("Z").filter(Boolean);
    assert.strictEqual(pieces.length, 2);
    assert(exported.endsWith("Z"), "each piece, including the last, must be closed");

    // Direct rendering through a canvas-like context produces the same
    // vector path as the exported string (up to coordinate precision).
    const context = recordingContext();
    b.context(context)(stations);
    assertPathEqual(context + "", exported);

    // Same fill regions and same winding: per-piece signed areas agree in
    // sign and magnitude within coordinate precision.
    const expected = subpaths(exported).map(signedArea);
    const actual = subpaths(context + "").map(signedArea);
    assert.strictEqual(actual.length, expected.length);
    for (let i = 0; i < expected.length; ++i) {
      assert(Math.sign(actual[i]) === Math.sign(expected[i]),
          `piece ${i} winding mismatch: ${actual[i]} vs ${expected[i]}`);
      assertInDelta(actual[i], expected[i]);
    }
  }
});
