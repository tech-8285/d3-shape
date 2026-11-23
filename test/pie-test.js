/* eslint-disable no-loss-of-precision */
import assert from "node:assert";
import {it} from "vitest";
import {arc, pie} from "d3-shape";

it("pie() returns a default pie shape", () => {
  const p = pie();
  assert.strictEqual(p.value()(42), 42);
  assert(p.sortValues()(1, 2) > 0);
  assert(p.sortValues()(2, 1) < 0);
  assert.strictEqual(p.sortValues()(1, 1), 0);
  assert.strictEqual(p.sort(), null);
  assert.strictEqual(p.startAngle()(), 0);
  assert.strictEqual(p.endAngle()(), 2 * Math.PI);
  assert.strictEqual(p.padAngle()(), 0);
});

it("pie(data) returns arcs in input order", () => {
  const p = pie();
  assert.deepStrictEqual(p([1, 3, 2]), [
    {data: 1, value: 1, index: 2, startAngle: 5.235987755982988, endAngle: 6.283185307179585, padAngle: 0},
    {data: 3, value: 3, index: 0, startAngle: 0.000000000000000, endAngle: 3.141592653589793, padAngle: 0},
    {data: 2, value: 2, index: 1, startAngle: 3.141592653589793, endAngle: 5.235987755982988, padAngle: 0}
  ]);
});

it("pie(data) accepts an iterable", () => {
  const p = pie();
  assert.deepStrictEqual(p(new Set([1, 3, 2])), [
    {data: 1, value: 1, index: 2, startAngle: 5.235987755982988, endAngle: 6.283185307179585, padAngle: 0},
    {data: 3, value: 3, index: 0, startAngle: 0.000000000000000, endAngle: 3.141592653589793, padAngle: 0},
    {data: 2, value: 2, index: 1, startAngle: 3.141592653589793, endAngle: 5.235987755982988, padAngle: 0}
  ]);
});

it("pie(data) coerces the specified value to a number", () => {
  const p = pie();
  const three = {valueOf: function() { return 3; }};
  assert.deepStrictEqual(p(["1", three, "2"]), [
    {data:   "1", value: 1, index: 2, startAngle: 5.235987755982988, endAngle: 6.283185307179585, padAngle: 0},
    {data: three, value: 3, index: 0, startAngle: 0.000000000000000, endAngle: 3.141592653589793, padAngle: 0},
    {data:   "2", value: 2, index: 1, startAngle: 3.141592653589793, endAngle: 5.235987755982988, padAngle: 0}
  ]);
});

it("pie(data) treats negative values as zero", () => {
  const p = pie();
  assert.deepStrictEqual(p([1, 0, -1]), [
    {data:  1, value:  1, index: 0, startAngle: 0.000000000000000, endAngle: 6.283185307179586, padAngle: 0},
    {data:  0, value:  0, index: 1, startAngle: 6.283185307179586, endAngle: 6.283185307179586, padAngle: 0},
    {data: -1, value: -1, index: 2, startAngle: 6.283185307179586, endAngle: 6.283185307179586, padAngle: 0}
  ]);
});

it("pie(data) treats NaN values as zero", () => {
  const p = pie();
  const actual = p([1, NaN, undefined]);
  const expected = [
    {data:         1, value:   1, index: 0, startAngle: 0.000000000000000, endAngle: 6.283185307179586, padAngle: 0},
    {data:       NaN, value: NaN, index: 1, startAngle: 6.283185307179586, endAngle: 6.283185307179586, padAngle: 0},
    {data: undefined, value: NaN, index: 2, startAngle: 6.283185307179586, endAngle: 6.283185307179586, padAngle: 0}
  ];
  assert(isNaN(actual[1].data));
  assert(isNaN(actual[1].value));
  assert(isNaN(actual[2].value));
  actual[1].data = actual[1].value = actual[2].value =
  expected[1].data = expected[1].value = expected[2].value = {}; // deepEqual NaN
  assert.deepStrictEqual(actual, expected);
});

it("pie(data) puts everything at the startAngle when the sum is zero", () => {
  const p = pie();
  assert.deepStrictEqual(p([0, 0]), [
    {data: 0, value: 0, index: 0, startAngle: 0, endAngle: 0, padAngle: 0},
    {data: 0, value: 0, index: 1, startAngle: 0, endAngle: 0, padAngle: 0}
  ]);
  assert.deepStrictEqual(p.startAngle(1)([0, 0]), [
    {data: 0, value: 0, index: 0, startAngle: 1, endAngle: 1, padAngle: 0},
    {data: 0, value: 0, index: 1, startAngle: 1, endAngle: 1, padAngle: 0}
  ]);
});

it("pie(data) restricts |endAngle - startAngle| to τ", () => {
  const p = pie();
  assert.deepStrictEqual(p.startAngle(0).endAngle(7)([1, 2]), [
    {data: 1, value: 1, index: 1, startAngle: 4.1887902047863905, endAngle: 6.2831853071795860, padAngle: 0},
    {data: 2, value: 2, index: 0, startAngle: 0.0000000000000000, endAngle: 4.1887902047863905, padAngle: 0}
  ]);
  assert.deepStrictEqual(p.startAngle(7).endAngle(0)([1, 2]), [
    {data: 1, value: 1, index: 1, startAngle: 2.8112097952136095, endAngle: 0.7168146928204142, padAngle: 0},
    {data: 2, value: 2, index: 0, startAngle: 7.0000000000000000, endAngle: 2.8112097952136095, padAngle: 0}
  ]);
  assert.deepStrictEqual(p.startAngle(1).endAngle(8)([1, 2]), [
    {data: 1, value: 1, index: 1, startAngle: 5.1887902047863905, endAngle: 7.2831853071795860, padAngle: 0},
    {data: 2, value: 2, index: 0, startAngle: 1.0000000000000000, endAngle: 5.1887902047863905, padAngle: 0}
  ]);
  assert.deepStrictEqual(p.startAngle(8).endAngle(1)([1, 2]), [
    {data: 1, value: 1, index: 1, startAngle: 3.8112097952136095, endAngle: 1.7168146928204142, padAngle: 0},
    {data: 2, value: 2, index: 0, startAngle: 8.0000000000000000, endAngle: 3.8112097952136095, padAngle: 0}
  ]);
});

it("pie.value(value)(data) observes the specified value function", () => {
  assert.deepStrictEqual(pie().value(function(d, i) { return i; })(new Array(3)), [
    {data: undefined, value: 0, index: 2, startAngle: 6.2831853071795860, endAngle: 6.2831853071795860, padAngle: 0},
    {data: undefined, value: 1, index: 1, startAngle: 4.1887902047863905, endAngle: 6.2831853071795860, padAngle: 0},
    {data: undefined, value: 2, index: 0, startAngle: 0.0000000000000000, endAngle: 4.1887902047863905, padAngle: 0}
  ]);
});

it("pie.value(f)(data) passes d, i and data to the specified function f", () => {
  const data = ["a", "b"];
  let actual = [];
  pie().value(function() { actual.push([].slice.call(arguments)); })(data);
  assert.deepStrictEqual(actual, [["a", 0, data], ["b", 1, data]]);
});

it("pie().startAngle(f)(…) propagates the context and arguments to the specified function f", () => {
  const expected = {that: {}, args: [42]};
  let actual;
  pie().startAngle(function() { actual = {that: this, args: [].slice.call(arguments)}; }).apply(expected.that, expected.args);
  assert.deepStrictEqual(actual, expected);
});

it("pie().startAngle(θ)(data) observes the specified start angle", () => {
  assert.deepStrictEqual(pie().startAngle(Math.PI)([1, 2, 3]), [
    {data: 1, value: 1, index: 2, startAngle: 5.759586531581287, endAngle: 6.283185307179586, padAngle: 0},
    {data: 2, value: 2, index: 1, startAngle: 4.712388980384690, endAngle: 5.759586531581287, padAngle: 0},
    {data: 3, value: 3, index: 0, startAngle: 3.141592653589793, endAngle: 4.712388980384690, padAngle: 0}
  ]);
});

it("pie().endAngle(θ)(data) observes the specified end angle", () => {
  assert.deepStrictEqual(pie().endAngle(Math.PI)([1, 2, 3]), [
    {data: 1, value: 1, index: 2, startAngle: 2.6179938779914940, endAngle: 3.1415926535897927, padAngle: 0},
    {data: 2, value: 2, index: 1, startAngle: 1.5707963267948966, endAngle: 2.6179938779914940, padAngle: 0},
    {data: 3, value: 3, index: 0, startAngle: 0.0000000000000000, endAngle: 1.5707963267948966, padAngle: 0}
  ]);
});

it("pie().padAngle(δ)(data) observes the specified pad angle", () => {
  assert.deepStrictEqual(pie().padAngle(0.1)([1, 2, 3]), [
    {data: 1, value: 1, index: 2, startAngle: 5.1859877559829880, endAngle: 6.2831853071795850, padAngle: 0.1},
    {data: 2, value: 2, index: 1, startAngle: 3.0915926535897933, endAngle: 5.1859877559829880, padAngle: 0.1},
    {data: 3, value: 3, index: 0, startAngle: 0.0000000000000000, endAngle: 3.0915926535897933, padAngle: 0.1}
  ]);
});

it("pie().endAngle(f)(…) propagates the context and arguments to the specified function f", () => {
  const expected = {that: {}, args: [42]};
  let actual;
  pie().endAngle(function() { actual = {that: this, args: [].slice.call(arguments)}; }).apply(expected.that, expected.args);
  assert.deepStrictEqual(actual, expected);
});

it("pie().padAngle(f)(…) propagates the context and arguments to the specified function f", () => {
  const expected = {that: {}, args: [42]};
  let actual;
  pie().padAngle(function() { actual = {that: this, args: [].slice.call(arguments)}; }).apply(expected.that, expected.args);
  assert.deepStrictEqual(actual, expected);
});

it("pie().startAngle(θ₀).endAngle(θ₁).padAngle(δ)(data) restricts the pad angle to |θ₁ - θ₀| / data.length", () => {
  assert.deepStrictEqual(pie().startAngle(0).endAngle(Math.PI).padAngle(Infinity)([1, 2, 3]), [
    {data: 1, value: 1, index: 2, startAngle:  2.0943951023931953, endAngle:  3.1415926535897930, padAngle: 1.0471975511965976},
    {data: 2, value: 2, index: 1, startAngle:  1.0471975511965976, endAngle:  2.0943951023931953, padAngle: 1.0471975511965976},
    {data: 3, value: 3, index: 0, startAngle:  0.0000000000000000, endAngle:  1.0471975511965976, padAngle: 1.0471975511965976}
  ]);
  assert.deepStrictEqual(pie().startAngle(0).endAngle(-Math.PI).padAngle(Infinity)([1, 2, 3]), [
    {data: 1, value: 1, index: 2, startAngle: -2.0943951023931953, endAngle: -3.1415926535897930, padAngle: 1.0471975511965976},
    {data: 2, value: 2, index: 1, startAngle: -1.0471975511965976, endAngle: -2.0943951023931953, padAngle: 1.0471975511965976},
    {data: 3, value: 3, index: 0, startAngle:  0.0000000000000000, endAngle: -1.0471975511965976, padAngle: 1.0471975511965976}
  ]);
});

it("pie.sortValues(f) sorts arcs by value per the specified comparator function f", () => {
  const p = pie();
  assert.deepStrictEqual(p.sortValues(function(a, b) { return a - b; })([1, 3, 2]), [
    {data: 1, value: 1, index: 0, startAngle: 0.0000000000000000, endAngle: 1.0471975511965976, padAngle: 0},
    {data: 3, value: 3, index: 2, startAngle: 3.1415926535897930, endAngle: 6.2831853071795860, padAngle: 0},
    {data: 2, value: 2, index: 1, startAngle: 1.0471975511965976, endAngle: 3.1415926535897930, padAngle: 0}
  ]);
  assert.deepStrictEqual(p.sortValues(function(a, b) { return b - a; })([1, 3, 2]), [
    {data: 1, value: 1, index: 2, startAngle: 5.2359877559829880, endAngle: 6.2831853071795850, padAngle: 0},
    {data: 3, value: 3, index: 0, startAngle: 0.0000000000000000, endAngle: 3.1415926535897930, padAngle: 0},
    {data: 2, value: 2, index: 1, startAngle: 3.1415926535897930, endAngle: 5.2359877559829880, padAngle: 0}
  ]);
  assert.strictEqual(p.sort(), null);
});

it("pie.sort(f) sorts arcs by data per the specified comparator function f", () => {
  const a = {valueOf: function() { return 1; }, name: "a"};
  const b = {valueOf: function() { return 2; }, name: "b"};
  const c = {valueOf: function() { return 3; }, name: "c"};
  const p = pie();
  assert.deepStrictEqual(p.sort(function(a, b) { return a.name.localeCompare(b.name); })([a, c, b]), [
    {data: a, value: 1, index: 0, startAngle: 0.0000000000000000, endAngle: 1.0471975511965976, padAngle: 0},
    {data: c, value: 3, index: 2, startAngle: 3.1415926535897930, endAngle: 6.2831853071795860, padAngle: 0},
    {data: b, value: 2, index: 1, startAngle: 1.0471975511965976, endAngle: 3.1415926535897930, padAngle: 0}
  ]);
  assert.deepStrictEqual(p.sort(function(a, b) { return b.name.localeCompare(a.name); })([a, c, b]), [
    {data: a, value: 1, index: 2, startAngle: 5.2359877559829880, endAngle: 6.2831853071795850, padAngle: 0},
    {data: c, value: 3, index: 0, startAngle: 0.0000000000000000, endAngle: 3.1415926535897930, padAngle: 0},
    {data: b, value: 2, index: 1, startAngle: 3.1415926535897930, endAngle: 5.2359877559829880, padAngle: 0}
  ]);
  assert.strictEqual(p.sortValues(), null);
});

// The inner-edge arc actually drawn by arc() with the default pad radius and
// no corner radius: the full sector span minus the inner padding clipping.
function visibleInnerAngle(d, r0, r1) {
  const span = Math.abs(d.endAngle - d.startAngle);
  if (!(r0 > 0) || !(d.padAngle > 0)) return span;
  const rp = Math.sqrt(r0 * r0 + r1 * r1);
  const p0 = 2 * Math.asin(Math.min(1, rp / r0 * Math.sin(d.padAngle / 2)));
  return span - p0;
}

it("pie() defaults the minimum-angle feature off", () => {
  const p = pie();
  assert.strictEqual(p.minAngle()(42), 0);
  assert.strictEqual(p.innerRadius()(42), 0);
  assert.strictEqual(p.outerRadius()(42), 1);
  assert.deepStrictEqual(pie().minAngle(0)([1, 3, 2]), pie()([1, 3, 2]));
});

it("pie.minAngle(α) keeps the specified visible inner angle on every positive sector", () => {
  const p = pie().minAngle(0.05).padAngle(0.02).innerRadius(50).outerRadius(100);
  const arcs = p([1, 1, 1, 1]);
  assert.strictEqual(arcs[0].padAngle, 0.02);
  for (const d of arcs) {
    assert.ok(visibleInnerAngle(d, 50, 100) >= 0.05 - 1e-9);
  }
  // Equal values get equal visible angles, and the sectors still tile τ.
  assert.ok(Math.abs(visibleInnerAngle(arcs[0], 50, 100) - visibleInnerAngle(arcs[1], 50, 100)) < 1e-12);
  assert.ok(Math.abs(arcs[arcs.length - 1].endAngle - 2 * Math.PI) < 1e-12);
});

it("pie.minAngle(α) protects small sectors while large sectors stay proportional", () => {
  const arcs = pie().minAngle(0.5)([100, 1]);
  assert.strictEqual(arcs[1].padAngle, 0);
  assert.ok(Math.abs((arcs[1].endAngle - arcs[1].startAngle) - 0.5) < 1e-9);
  assert.ok(Math.abs((arcs[0].endAngle - arcs[0].startAngle) - (2 * Math.PI - 0.5)) < 1e-9);
  assert.ok(Math.abs(arcs[1].endAngle - 2 * Math.PI) < 1e-12);
});

it("pie.minAngle(α) shrinks the uniform pad angle when space is tight", () => {
  const p = pie().startAngle(0).endAngle(Math.PI).padAngle(0.3).minAngle(0.8).innerRadius(50).outerRadius(100);
  const arcs = p([4, 2, 1]);
  assert.ok(arcs[0].padAngle > 0);
  assert.ok(arcs[0].padAngle < 0.3);
  assert.ok(arcs.every(d => d.padAngle === arcs[0].padAngle));
  for (const d of arcs) assert.ok(visibleInnerAngle(d, 50, 100) >= 0.8 - 1e-9);
  assert.ok(Math.abs(arcs[arcs.length - 1].endAngle - Math.PI) < 1e-9);
});

it("pie.minAngle(α) splits the sweep equally when the floor cannot fit even without padding", () => {
  const arcs = pie().padAngle(0.2).minAngle(1)([1, 10, 2, 9, 3, 8, 4, 7, 5, 6]);
  assert.strictEqual(arcs[0].padAngle, 0);
  for (const d of arcs) {
    assert.ok(Math.abs((d.endAngle - d.startAngle) - 2 * Math.PI / 10) < 1e-12);
  }
  assert.ok(Math.abs(Math.max(...arcs.map(d => d.endAngle)) - 2 * Math.PI) < 1e-12);
});

it("pie.minAngle(α) gives non-positive sectors only the uniform pad angle", () => {
  const p = pie().minAngle(0.3).padAngle(0.05).innerRadius(50).outerRadius(100);
  const arcs = p([10, -5, 0, 5]);
  assert.ok(Math.abs((arcs[1].endAngle - arcs[1].startAngle) - 0.05) < 1e-12);
  assert.ok(Math.abs((arcs[2].endAngle - arcs[2].startAngle) - 0.05) < 1e-12);
  for (const d of arcs) if (d.value > 0) assert.ok(visibleInnerAngle(d, 50, 100) >= 0.3 - 1e-9);
  assert.ok(Math.abs(Math.max(...arcs.map(d => d.endAngle)) - 2 * Math.PI) < 1e-12);
});

it("pie.minAngle(α) follows a reverse (negative) sweep", () => {
  const arcs = pie().startAngle(2 * Math.PI).endAngle(0).minAngle(0.5)([100, 1]);
  assert.strictEqual(arcs[0].index, 0);
  assert.ok(arcs[0].startAngle === 2 * Math.PI);
  assert.ok(arcs[0].endAngle < arcs[0].startAngle);
  assert.ok(arcs[1].endAngle < arcs[1].startAngle);
  assert.ok(Math.abs(arcs[1].startAngle - 0.5) < 1e-9);
  assert.strictEqual(arcs[1].endAngle, 0);
});

it("pie.minAngle(α) tolerates a zero inner radius", () => {
  const arcs = pie().minAngle(0.3).padAngle(0.1)([10, 1]);
  assert.strictEqual(arcs[0].padAngle, 0.1);
  // With no inner edge there is no inner clipping: the sector spans are the
  // visible angles themselves and the pad gaps are applied by the arc
  // generator when rendering. Shares stay proportional to value (10:1), the
  // small sector keeps above the floor, and the spans tile τ.
  const spans = arcs.map(d => d.endAngle - d.startAngle);
  assert.ok(Math.abs(spans[0] / spans[1] - 10) < 1e-12);
  assert.ok(Math.abs(spans[1] - 2 * Math.PI / 11) < 1e-12);
  assert.ok(spans[1] >= 0.3 - 1e-12);
  assert.ok(Math.abs(spans.reduce((s, x) => s + x, 0) - 2 * Math.PI) < 1e-12);
});

it("pie.minAngle(α) honors per-item inner and outer radii", () => {
  const data = [
    {v: 10, r0: 40, r1: 80},
    {v: 1, r0: 60, r1: 120}
  ];
  const p = pie()
      .value(d => d.v)
      .innerRadius(d => d.r0)
      .outerRadius(d => d.r1)
      .padAngle(0.05)
      .minAngle(0.4);
  const arcs = p(data);
  arcs.forEach(d => assert.ok(visibleInnerAngle(d, d.data.r0, d.data.r1) >= 0.4 - 1e-9));
  assert.ok(arcs.every(d => d.padAngle === 0.05));
  assert.ok(Math.abs(arcs[arcs.length - 1].endAngle - 2 * Math.PI) < 1e-12);
});

it("pie.minAngle(f) and friends accept accessor functions and propagate arguments", () => {
  const expected = {that: {}, args: [42]};
  let actual;
  pie().minAngle(function() { actual = {that: this, args: [].slice.call(arguments)}; }).apply(expected.that, expected.args);
  assert.deepStrictEqual(actual, expected);
  const p = pie().minAngle(0.7).innerRadius(d => d.r0).outerRadius(d => d.r1);
  assert.strictEqual(p.minAngle()(), 0.7);
  assert.strictEqual(p.innerRadius()({r0: 33}), 33);
  assert.strictEqual(p.outerRadius()({r1: 99}), 99);
  const data = [
    {v: 5, r0: 50, r1: 100, valueOf() { return this.v; }},
    {v: 1, r0: 50, r1: 100, valueOf() { return this.v; }}
  ];
  const arcs = p(data);
  arcs.forEach(d => assert.ok(visibleInnerAngle(d, 50, 100) >= 0.7 - 1e-9));
});

it("pie.minAngle(α) output is directly drawable by the arc generator", () => {
  const a = arc().innerRadius(50).outerRadius(100);
  const arcs = pie().minAngle(0.3).padAngle(0.04).innerRadius(50).outerRadius(100)([8, 1, 3]);
  for (const d of arcs) {
    const path = a(d);
    assert.strictEqual(typeof path, "string");
    assert.ok(path.startsWith("M"));
    assert.ok(Number.isFinite(d.startAngle) && Number.isFinite(d.endAngle));
  }
});

it("pie.minAngle(α) keeps the selected sort order and tiles a partial forward sweep", () => {
  const p = pie().startAngle(-Math.PI / 2).endAngle(Math.PI / 2).minAngle(0.4).innerRadius(50).outerRadius(100);
  const arcs = p([1, 100, 2]);
  assert.deepStrictEqual(arcs.map(d => d.index), [2, 0, 1]); // default descending sort by value
  assert.ok(Math.abs(arcs.find(d => d.index === 0).startAngle + Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(Math.max(...arcs.map(d => d.endAngle)) - Math.PI / 2) < 1e-12);
  for (const d of arcs) assert.ok(visibleInnerAngle(d, 50, 100) >= 0.4 - 1e-9);
});

it("pie.minAngle(α) tiles a reverse sweep with padding", () => {
  const arcs = pie().startAngle(Math.PI).endAngle(0).padAngle(0.05).minAngle(0.3).innerRadius(50).outerRadius(100)([8, 1]);
  for (const d of arcs) {
    assert.ok(d.endAngle <= d.startAngle + 1e-12);
    assert.ok(visibleInnerAngle(d, 50, 100) >= 0.3 - 1e-9);
  }
  const first = arcs.find(d => d.index === 0);
  const last = arcs.find(d => d.index === 1);
  assert.strictEqual(first.startAngle, Math.PI);
  assert.ok(Math.abs(last.endAngle) < 1e-12);
});

it("pie.minAngle(α) falls back to the regular layout when no value is positive", () => {
  assert.deepStrictEqual(pie().minAngle(0.5)([0, -1, NaN]), pie()([0, -1, NaN]));
  assert.deepStrictEqual(pie().minAngle(0.5)([]), pie()([]));
});

it("pie.minAngle(α) handles a single positive sector", () => {
  const arcs = pie().minAngle(0.3).padAngle(0.1).innerRadius(50).outerRadius(100)([7]);
  assert.strictEqual(arcs.length, 1);
  assert.strictEqual(arcs[0].startAngle, 0);
  assert.ok(Math.abs(arcs[0].endAngle - 2 * Math.PI) < 1e-12);
  assert.ok(visibleInnerAngle(arcs[0], 50, 100) >= 0.3);
});

it("pie.minAngle(α) leaves the caller pad angle untouched when the floor already fits", () => {
  const arcs = pie().minAngle(0.01).padAngle(0.08).innerRadius(50).outerRadius(100)([4, 2, 1]);
  assert.ok(arcs.every(d => d.padAngle === 0.08));
  for (const d of arcs) assert.ok(visibleInnerAngle(d, 50, 100) >= 0.01 - 1e-9);
});

