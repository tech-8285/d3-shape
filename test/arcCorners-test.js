import assert from "node:assert";
import {it} from "vitest";
import {arc} from "d3-shape";

// These tests exercise the contour produced for a padded annular sector.
// Padding trims each rim by an angle that depends on that rim’s radius, so the
// inner and outer rims are left with different arc lengths; the corner rounding
// that follows is therefore limited differently on each rim. The assertions
// work with the emitted path primitives (rim arcs, corner arcs, edge lines) and
// compare them to an independent model of the padded annular sector, rather
// than to pre-baked SVG strings.

const tau = 2 * Math.PI;
const halfPi = Math.PI / 2;
const tolerance = 1e-9;

// -- vector helpers ---------------------------------------------------------

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const magnitude = a => Math.hypot(a[0], a[1]);
const distance = (a, b) => magnitude(subtract(a, b));
const normalize = a => { const l = magnitude(a); return l > 0 ? scale(a, 1 / l) : [0, 0]; };
const polar = (radius, angle) => [radius * Math.cos(angle), radius * Math.sin(angle)];

function wrap(angle) {
  const a = angle % tau;
  return a < 0 ? a + tau : a;
}

// Signed difference in (−π, π].
function signedAngle(from, to) {
  const a = wrap(to - from);
  return a > Math.PI ? a - tau : a;
}

function assertClose(actual, expected, epsilon, message) {
  const delta = Math.abs(actual - expected);
  assert.ok(delta <= epsilon, `${message}: expected ${expected}, got ${actual} (Δ ${delta})`);
}

// -- contour recording ------------------------------------------------------

// Run the arc generator against a recording context and rebuild the drawn
// contour as lines and arcs. A canvas/SVG context implicitly connects the
// current point to an arc’s start, and implied zero-length segments are dropped.
function contourOf(options) {
  const {
    innerRadius, outerRadius, startAngle, endAngle,
    padAngle = 0, padRadius = null, cornerRadius = 0
  } = options;
  const generator = arc()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius)
      .startAngle(startAngle)
      .endAngle(endAngle)
      .padAngle(padAngle)
      .cornerRadius(cornerRadius);
  if (padRadius != null) generator.padRadius(padRadius);

  const commands = [];
  generator.context({
    moveTo(x, y) { commands.push({type: "M", x, y}); },
    lineTo(x, y) { commands.push({type: "L", x, y}); },
    arc(x, y, radius, start, end, anticlockwise) {
      commands.push({type: "A", x, y, radius, start, end, anticlockwise: !!anticlockwise});
    },
    closePath() { commands.push({type: "Z"}); }
  })({});

  const segments = [];
  let cursor = null, start = null, closed = false;
  const lineTo = point => {
    if (cursor && distance(cursor, point) > tolerance) segments.push({type: "line", from: cursor, to: point});
    cursor = point;
  };
  for (const command of commands) {
    if (command.type === "M") {
      cursor = [command.x, command.y];
      start = cursor;
    } else if (command.type === "L") {
      lineTo([command.x, command.y]);
    } else if (command.type === "A") {
      const center = [command.x, command.y];
      const from = add(center, polar(command.radius, command.start));
      const to = add(center, polar(command.radius, command.end));
      lineTo(from);
      const sweep = command.anticlockwise
          ? -wrap(command.start - command.end)
          : wrap(command.end - command.start);
      segments.push({type: "arc", center, radius: command.radius, startAngle: command.start, sweep, from, to});
      cursor = to;
    } else if (command.type === "Z") {
      closed = true;
      lineTo(start);
      cursor = start;
    }
  }
  return {segments, closed};
}

const isRimArc = segment => segment.type === "arc" && magnitude(segment.center) < tolerance;
const isCornerArc = segment => segment.type === "arc" && magnitude(segment.center) >= tolerance;
const rimArcs = (contour, radius) =>
    contour.segments.filter(s => isRimArc(s) && Math.abs(s.radius - radius) < tolerance);
const cornerArcs = contour => contour.segments.filter(isCornerArc);

// The rim (50 or 100…) a corner arc is tangent to, or null if it touches neither.
function tangentRim(segment, innerRadius, outerRadius) {
  const centerRadius = magnitude(segment.center);
  if (Math.abs(centerRadius + segment.radius - outerRadius) < 1e-6) return outerRadius;
  if (Math.abs(centerRadius - segment.radius - innerRadius) < 1e-6) return innerRadius;
  return null;
}

// Green’s theorem over the contour; the sign carries the winding direction.
function signedArea(segments) {
  let area = 0;
  for (const segment of segments) {
    if (segment.type === "line") {
      area += 0.5 * cross(segment.from, segment.to);
    } else {
      const r = segment.radius, theta = segment.sweep, t = segment.startAngle;
      const [cx, cy] = segment.center;
      area += 0.5 * (r * r * theta
          + cx * r * (Math.sin(t + theta) - Math.sin(t))
          - cy * r * (Math.cos(t + theta) - Math.cos(t)));
    }
  }
  return area;
}

function assertClosed(contour, message) {
  assert.ok(contour.closed, `${message}: contour must be closed`);
  const {segments} = contour;
  assert.ok(segments.length > 0, `${message}: contour must not be empty`);
  for (let i = 0; i < segments.length; i++) {
    const next = segments[(i + 1) % segments.length];
    assert.ok(distance(segments[i].to, next.from) < 1e-9,
        `${message}: gap between segments ${i} and ${(i + 1) % segments.length}`);
  }
}

// Every endpoint must sit in the annulus; otherwise the contour would fill
// area the sector does not own.
function assertWithinAnnulus(contour, innerRadius, outerRadius, message) {
  for (const segment of contour.segments) {
    for (const point of [segment.from, segment.to]) {
      const r = magnitude(point);
      assert.ok(r >= innerRadius - tolerance && r <= outerRadius + tolerance,
          `${message}: vertex ${point} at radius ${r} escapes [${innerRadius}, ${outerRadius}]`);
    }
  }
}

// -- independent annular-sector model --------------------------------------

// The padded sector is the annulus cut by two straight edges, each tangent to a
// circle of radius `gap` about the origin. `gap` is the clearance that the
// padding angle leaves between neighbouring sectors.
function paddedSector(options) {
  const {
    innerRadius: r0, outerRadius: r1, startAngle, endAngle,
    padAngle = 0, padRadius = null
  } = options;
  const direction = endAngle >= startAngle ? 1 : -1;
  const width = Math.abs(endAngle - startAngle);
  const a0 = startAngle - halfPi, a1 = endAngle - halfPi;
  const mid = (a0 + a1) / 2;
  const gap = (padRadius == null ? Math.hypot(r0, r1) : padRadius) * Math.sin(padAngle / 2);

  // Each edge is tangent to the gap circle, so it is trimmed back by the angle
  // the gap subtends at that radius.
  const trim = R => gap >= R ? halfPi : Math.asin(gap / R);
  const available = R => Math.max(0, width - 2 * trim(R));
  const cornerAngle = (R, side) =>
      available(R) > 0
          ? (side === 0 ? a0 + direction * trim(R) : a1 - direction * trim(R))
          : mid;
  const cornerPoint = (R, side) => polar(R, cornerAngle(R, side));

  const edges = [0, 1].map(side => {
    const point = cornerPoint(r1, side);
    const toInner = cornerPoint(r0, side);
    const unit = normalize(subtract(toInner, point));
    let normal = [-unit[1], unit[0]];
    if (dot(subtract(polar((r0 + r1) / 2, mid), point), normal) < 0) normal = scale(normal, -1);
    return {point, direction: unit, normal};
  });

  // The edge rays meet at an apex gap / sin(width / 2) from the origin and
  // subtend `width` there. A corner of radius ρ must clear its mirror image on
  // the other edge, which bounds ρ from above by `capacity`.
  const sinHalf = Math.sin(width / 2);
  const apexDistance = width > 0 ? gap / sinHalf : 0;
  const kappa = width > 0 ? 1 / sinHalf : Infinity;
  const capacity = (R, outer) =>
      width < Math.PI
          ? (outer ? (R - apexDistance) / (kappa + 1) : (R - apexDistance) / (kappa - 1))
          : Infinity;

  return {innerRadius: r0, outerRadius: r1, direction, width, mid, gap, trim, available,
    cornerAngle, cornerPoint, edges, capacity};
}

// Circle of radius ρ tangent to one edge line and to the rim of radius R, taken
// from inside for the outer rim and from outside for the inner rim. Of the two
// solutions the one nearest the corner is the one the contour uses.
function cornerCentre(model, R, radius, outer, side) {
  const edge = model.edges[side];
  const target = outer ? R - radius : R + radius;
  const b = dot(edge.point, edge.direction);
  const c = dot(edge.point, edge.point)
      + 2 * radius * dot(edge.point, edge.normal)
      + radius * radius - target * target;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const candidates = [-b + root, -b - root].map(t =>
      add(add(edge.point, scale(edge.direction, t)), scale(edge.normal, radius)));
  const corner = model.cornerPoint(R, side);
  candidates.sort((p, q) => distance(p, corner) - distance(q, corner));
  const center = candidates[0];
  const centerAngle = Math.atan2(center[1], center[0]);
  return {
    center,
    linePoint: add(edge.point, scale(edge.direction, dot(subtract(center, edge.point), edge.direction))),
    ringPoint: scale(center, R / magnitude(center)),
    // Angle of the rim that this corner arc replaces.
    consumed: Math.abs(signedAngle(centerAngle, model.cornerAngle(R, side)))
  };
}

// Arc length each rim keeps after both corners have eaten into it.
function retainedArc(model, R, radius, outer) {
  if (!(model.available(R) > 0)) return 0;
  let consumed = 0;
  for (const side of [0, 1]) consumed += cornerCentre(model, R, radius, outer, side).consumed;
  return Math.max(0, model.available(R) - consumed);
}

// Exact area of the padded sector before rounding. A collapsed rim has no arc;
// its two edges meet at the midpoint angle, which the edge terms below already
// encode through the corner points.
function paddedSectorArea(model) {
  const O0 = model.cornerPoint(model.outerRadius, 0);
  const O1 = model.cornerPoint(model.outerRadius, 1);
  const I0 = model.cornerPoint(model.innerRadius, 0);
  const I1 = model.cornerPoint(model.innerRadius, 1);
  const direction = model.direction;
  const outerArc = 0.5 * model.outerRadius ** 2 * direction * model.available(model.outerRadius);
  const innerArc = -0.5 * model.innerRadius ** 2 * direction * model.available(model.innerRadius);
  return outerArc + innerArc + 0.5 * (cross(O1, I1) + cross(I0, O0));
}

// -- tests -----------------------------------------------------------------

it("arc().padAngle(δ) trims the two rims of an annular sector by the angle the gap subtends at each radius", () => {
  const options = {innerRadius: 50, outerRadius: 100, startAngle: 0, endAngle: Math.PI / 2, padAngle: 0.1};
  const model = paddedSector(options);
  const contour = contourOf(options);
  const outer = rimArcs(contour, 100);
  const inner = rimArcs(contour, 50);

  assert.strictEqual(outer.length, 1, "one outer rim arc");
  assert.strictEqual(inner.length, 1, "one inner rim arc");
  assert.strictEqual(cornerArcs(contour).length, 0, "no corner arcs without cornerRadius");

  // gap = √(50² + 100²) · sin(0.05).
  assertClose(model.gap, 5.587840997410266, 1e-9, "padding gap");
  assertClose(Math.abs(outer[0].sweep), 1.458981267, 1e-8, "outer retained arc");
  assertClose(Math.abs(inner[0].sweep), 1.346814787, 1e-8, "inner retained arc");
  assertClose(Math.abs(outer[0].sweep), model.available(100), 1e-12, "outer arc versus available");
  assertClose(Math.abs(inner[0].sweep), model.available(50), 1e-12, "inner arc versus available");

  // The near rim loses more to the gap, so its difference is exactly the
  // difference of the two trimming angles.
  assertClose(Math.abs(outer[0].sweep) - Math.abs(inner[0].sweep),
      2 * (model.trim(50) - model.trim(100)), 1e-12, "difference of retained arcs");
  assert.ok(Math.abs(inner[0].sweep) < Math.abs(outer[0].sweep),
      "inner rim must retain less arc than the outer rim");
  assertClosed(contour, "padded annular sector");
});

it("arc().cornerRadius(r) is limited separately on each rim by that rim’s remaining corner", () => {
  // Width 0.8, pad 0.1: the outer rim has more corner room, so it can carry a
  // larger corner radius than the inner rim before its two corners meet.
  const options = {innerRadius: 50, outerRadius: 100, startAngle: 0, endAngle: 0.8, padAngle: 0.1};
  const model = paddedSector(options);
  const capacityOuter = model.capacity(100, true);
  const capacityInner = model.capacity(50, false);

  assertClose(capacityOuter, 24.005723990971617, 1e-9, "outer corner capacity");
  assertClose(capacityInner, 22.737460163010970, 1e-9, "inner corner capacity");
  assert.ok(capacityInner < capacityOuter, "the inner rim must run out of corner room first");
  assert.ok(capacityOuter < (100 - 50) / 2 + 1e-12, "capacity never exceeds half the ring width");

  // A generous requested radius saturates both rims, and each settles at its own
  // capacity: one merged corner arc per rim and no plain rim arc left.
  const generous = contourOf({...options, cornerRadius: Infinity});
  const generousFillets = cornerArcs(generous);
  assert.strictEqual(generousFillets.length, 2, "one merged corner arc per rim");
  assert.strictEqual(rimArcs(generous, 100).length, 0, "outer rim fully rounded away");
  assert.strictEqual(rimArcs(generous, 50).length, 0, "inner rim fully rounded away");
  const outerFillet = generousFillets.find(f => tangentRim(f, 50, 100) === 100);
  const innerFillet = generousFillets.find(f => tangentRim(f, 50, 100) === 50);
  assert.ok(outerFillet && innerFillet, "both corner arcs are tangent to their own rims");
  assertClose(outerFillet.radius, capacityOuter, 1e-9, "outer corner saturates at its capacity");
  assertClose(innerFillet.radius, capacityInner, 1e-9, "inner corner saturates at its capacity");
  assert.ok(innerFillet.radius < outerFillet.radius, "the rims keep different corner radii");

  // A radius between the two capacities is honoured on the outer rim but must be
  // reduced on the inner rim; the outer rim even keeps a sliver of arc.
  const between = contourOf({...options, cornerRadius: 23});
  const betweenFillets = cornerArcs(between);
  const outerFillets = betweenFillets.filter(f => tangentRim(f, 50, 100) === 100);
  const innerFillets = betweenFillets.filter(f => tangentRim(f, 50, 100) === 50);
  assert.strictEqual(outerFillets.length, 2, "outer rim keeps two separate corner arcs");
  assert.strictEqual(innerFillets.length, 1, "inner rim’s corners have merged");
  for (const fillet of outerFillets) assertClose(fillet.radius, 23, 1e-9, "outer corner keeps the requested radius");
  assertClose(innerFillets[0].radius, capacityInner, 1e-9, "inner corner is clipped to its capacity");
  assert.strictEqual(rimArcs(between, 100).length, 1, "outer rim keeps a sliver of arc");
  assert.ok(Math.abs(rimArcs(between, 100)[0].sweep) > 0, "retained outer arc is non-empty");
  assertClose(Math.abs(rimArcs(between, 100)[0].sweep),
      retainedArc(model, 100, 23, true), 1e-9, "outer sliver length matches its corner consumption");
  assert.strictEqual(rimArcs(between, 50).length, 0, "inner rim has no arc left");
});

it("arc().cornerRadius(r) joins each corner to its rim and its edge line tangentially", () => {
  const options = {innerRadius: 50, outerRadius: 100, startAngle: 0, endAngle: Math.PI / 2, padAngle: 0.1, cornerRadius: 10};
  const model = paddedSector(options);
  const contour = contourOf(options);
  const fillets = cornerArcs(contour);

  assert.strictEqual(fillets.length, 4, "two corners on each rim");
  assertClosed(contour, "rounded annular sector");
  assertWithinAnnulus(contour, 50, 100, "rounded annular sector");

  for (const fillet of fillets) {
    const centerRadius = magnitude(fillet.center);
    const rimRadius = tangentRim(fillet, 50, 100);
    assert.ok(rimRadius !== null, `corner arc at ${fillet.center} must touch exactly one rim`);
    const outer = rimRadius === 100;

    // Tangency to the nearer edge line, and the corner circle must stay clear
    // of the opposite edge.
    const distances = model.edges.map(edge => Math.abs(cross(subtract(fillet.center, edge.point), edge.direction)));
    const side = distances[0] <= distances[1] ? 0 : 1;
    assertClose(distances[side], fillet.radius, 1e-9, "corner circle must touch its edge line");
    assert.ok(distances[1 - side] > fillet.radius + 1e-9, "corner circle must clear the opposite edge");

    // Both endpoints are exactly the points predicted by tangency alone.
    const predicted = cornerCentre(model, rimRadius, fillet.radius, outer, side);
    const endpoints = [fillet.from, fillet.to];
    const lineEnd = endpoints.find(p => distance(p, predicted.linePoint) < 1e-8);
    const ringEnd = endpoints.find(p => distance(p, predicted.ringPoint) < 1e-8);
    assert.ok(lineEnd, "corner arc must meet its edge at the edge-tangency point");
    assert.ok(ringEnd, "corner arc must meet its rim at the rim-tangency point");

    // Edge tangency: the radius at the junction is perpendicular to the edge.
    const radial = normalize(subtract(lineEnd, fillet.center));
    assertClose(dot(radial, model.edges[side].direction), 0, 1e-9, "corner-to-line tangency");
    // Rim tangency: the junction lies on both circles and is the radial
    // projection of the corner centre, i.e. the two circles are tangent there.
    assertClose(magnitude(ringEnd), rimRadius, 1e-9, "junction lies on the rim");
    assertClose(distance(ringEnd, fillet.center), fillet.radius, 1e-9, "junction lies on the corner circle");
    assertClose(distance(ringEnd, scale(fillet.center, rimRadius / centerRadius)), 0, 1e-9,
        "rim junction is the radial projection of the corner centre");
  }
});

it("arc().cornerRadius(r) leaves each rim an arc length that matches its own corner constraints", () => {
  const options = {innerRadius: 50, outerRadius: 100, startAngle: 0, endAngle: 0.8, padAngle: 0.1, cornerRadius: 5};
  const model = paddedSector(options);
  const contour = contourOf(options);
  const outer = rimArcs(contour, 100);
  const inner = rimArcs(contour, 50);

  assert.strictEqual(outer.length, 1, "one outer rim arc");
  assert.strictEqual(inner.length, 1, "one inner rim arc");
  assert.strictEqual(cornerArcs(contour).length, 4, "both corners on both rims stay separate");

  // Available arc minus the angle each corner consumes, computed per rim.
  assertClose(Math.abs(outer[0].sweep), retainedArc(model, 100, 5, true), 1e-9, "outer retained arc");
  assertClose(Math.abs(inner[0].sweep), retainedArc(model, 50, 5, false), 1e-9, "inner retained arc");

  // Reference values derived from the sector geometry alone.
  assertClose(Math.abs(outer[0].sweep), 0.576634030, 1e-8, "outer arc reference");
  assertClose(Math.abs(inner[0].sweep), 0.412569040, 1e-8, "inner arc reference");

  const outerConsumed = cornerCentre(model, 100, 5, true, 0).consumed
      + cornerCentre(model, 100, 5, true, 1).consumed;
  assertClose(model.available(100) - Math.abs(outer[0].sweep), outerConsumed, 1e-9,
      "outer rim’s two corners account for the trimmed arc");
  assert.ok(Math.abs(inner[0].sweep) < Math.abs(outer[0].sweep),
      "the inner rim retains less arc than the outer rim once rounded");
  assertClosed(contour, "rounded annular sector");
});

it("arc() keeps the corner arc tangent to both edges when one rim’s corners have merged", () => {
  // Width 0.3 leaves the inner rim less room than the requested radius, so its
  // two corners merge into one arc while the outer rim still carries two.
  const options = {innerRadius: 50, outerRadius: 100, startAngle: 0, endAngle: 0.3, padAngle: 0.1, cornerRadius: 5};
  const model = paddedSector(options);
  const contour = contourOf(options);
  const fillets = cornerArcs(contour);

  const capacityInner = model.capacity(50, false);
  assertClose(capacityInner, 2.215083579691768, 1e-9, "inner corner capacity");

  const innerFillets = fillets.filter(f => tangentRim(f, 50, 100) === 50);
  const outerFillets = fillets.filter(f => tangentRim(f, 50, 100) === 100);
  assert.strictEqual(innerFillets.length, 1, "inner rim’s two corners have merged");
  assert.strictEqual(outerFillets.length, 2, "outer rim keeps two corners");
  assertClose(innerFillets[0].radius, capacityInner, 1e-9, "merged inner corner uses its capacity");

  // The merged arc still touches both edge lines.
  for (const edge of model.edges) {
    assertClose(Math.abs(cross(subtract(innerFillets[0].center, edge.point), edge.direction)),
        capacityInner, 1e-9, "merged inner corner is tangent to both edges");
  }
  // It wraps the corner, so it spans π − width rather than a short arc.
  assertClose(Math.abs(innerFillets[0].sweep), Math.PI - 0.3, 1e-9, "merged inner corner spans π − width");
  assert.strictEqual(rimArcs(contour, 50).length, 0, "inner rim has no plain arc left");
  assert.strictEqual(rimArcs(contour, 100).length, 1, "outer rim still has an arc");
  assertClosed(contour, "partially merged corners");
});

it("arc() still encloses a fillable region as the sector narrows until the inner rim loses its arc", () => {
  const innerRadius = 50, outerRadius = 100, padAngle = 0.1;
  const model = paddedSector({innerRadius, outerRadius, startAngle: 0, endAngle: 1, padAngle});
  const innerThreshold = 2 * model.trim(innerRadius);
  const outerThreshold = 2 * model.trim(outerRadius);
  assertClose(innerThreshold, 0.223981539942863, 1e-9, "inner rim runs out of arc at this width");
  assertClose(outerThreshold, 0.111815060004883, 1e-9, "outer rim runs out of arc at this width");

  const widths = [0.3, 0.25, 0.24, 0.2, 0.15, 0.12];
  let previousArea = Infinity;
  for (const width of widths) {
    const options = {innerRadius, outerRadius, startAngle: 0, endAngle: width, padAngle};
    const sector = paddedSector(options);
    const contour = contourOf(options);
    const area = signedArea(contour.segments);

    assertClosed(contour, `width ${width}`);
    assertWithinAnnulus(contour, innerRadius, outerRadius, `width ${width}`);
    assertClose(area, paddedSectorArea(sector), 1e-9, `width ${width} encloses exactly the padded sector`);
    assert.ok(area > 0, `width ${width} must enclose a positive area`);
    assert.ok(area < previousArea, `width ${width} must enclose less area than the wider sector`);
    previousArea = area;

    if (width > innerThreshold) {
      const inner = rimArcs(contour, innerRadius);
      assert.strictEqual(inner.length, 1, `width ${width} keeps an inner rim arc`);
      assertClose(Math.abs(inner[0].sweep), sector.available(innerRadius), 1e-9, `width ${width} inner arc length`);
    } else {
      assert.strictEqual(rimArcs(contour, innerRadius).length, 0, `width ${width} has no inner rim arc`);
      // The inner boundary has collapsed to the single point on the bisector.
      const innerPoint = polar(innerRadius, sector.mid);
      const touches = contour.segments.some(s =>
          distance(s.to, innerPoint) < 1e-9 || distance(s.from, innerPoint) < 1e-9);
      assert.ok(touches, `width ${width} inner boundary passes through the collapsed point`);
    }

    if (width > outerThreshold) {
      assert.strictEqual(rimArcs(contour, outerRadius).length, 1, `width ${width} keeps an outer rim arc`);
    } else {
      assert.strictEqual(rimArcs(contour, outerRadius).length, 0, `width ${width} has lost its outer rim arc too`);
    }
  }

  // Once padding has eaten the outer arc as well, nothing fillable remains.
  const empty = contourOf({innerRadius, outerRadius, startAngle: 0, endAngle: 0.05, padAngle});
  assertClose(signedArea(empty.segments), 0, 1e-12, "no fillable area once both rims collapse");
  assertClosed(empty, "collapsed sector");
});

it("arc() reverses only the winding when the sweep is reversed", () => {
  // Cover the rounded, unrounded and inner-collapsed branches, since each
  // emits its rim arcs through a different code path.
  const shapes = [
    {innerRadius: 50, outerRadius: 100, padAngle: 0.1, cornerRadius: 5, width: 0.5},
    {innerRadius: 50, outerRadius: 100, padAngle: 0.1, cornerRadius: 0, width: 0.5},
    {innerRadius: 50, outerRadius: 100, padAngle: 0.1, cornerRadius: 0, width: 0.15},
    {innerRadius: 0, outerRadius: 100, padAngle: 0.1, cornerRadius: 0, width: 0.5}
  ];

  for (const {width, ...base} of shapes) {
    const label = `rc=${base.cornerRadius} width=${width} inner=${base.innerRadius}`;
    const forward = contourOf({...base, startAngle: 0, endAngle: width});
    const reversed = contourOf({...base, startAngle: width, endAngle: 0});

    assertClosed(forward, `forward ${label}`);
    assertClosed(reversed, `reversed ${label}`);
    assert.strictEqual(forward.segments.length, reversed.segments.length, `${label}: same segment count`);

    // The same primitives appear in both traversals, only wound the other way.
    const key = segment => {
      const length = Math.abs(segment.sweep).toFixed(9);
      return isRimArc(segment)
          ? `rim:${segment.radius.toFixed(9)}:${length}`
          : `corner:${segment.center.map(v => v.toFixed(9)).join(",")}:${segment.radius.toFixed(9)}:${length}`;
    };
    const forwardArcs = forward.segments.filter(s => s.type === "arc").map(key).sort();
    const reversedArcs = reversed.segments.filter(s => s.type === "arc").map(key).sort();
    assert.deepStrictEqual(reversedArcs, forwardArcs, `${label}: both traversals use the same arcs`);

    for (const radius of [base.innerRadius, base.outerRadius].filter(r => r > 0)) {
      const f = rimArcs(forward, radius), r = rimArcs(reversed, radius);
      if (!f.length && !r.length) continue;
      assert.strictEqual(f.length, 1, `${label}: forward rim ${radius} has one arc`);
      assert.strictEqual(r.length, 1, `${label}: reversed rim ${radius} has one arc`);
      assertClose(Math.abs(f[0].sweep), Math.abs(r[0].sweep), 1e-9, `${label}: rim ${radius} arc length unchanged`);
      assert.ok(f[0].sweep * r[0].sweep < 0, `${label}: rim ${radius} is traversed the other way`);
    }

    const forwardArea = signedArea(forward.segments);
    const reversedArea = signedArea(reversed.segments);
    assert.ok(forwardArea > 0, `${label}: forward sector is filled clockwise`);
    assert.ok(reversedArea < 0, `${label}: reversed sector is filled anticlockwise`);
    assertClose(Math.abs(forwardArea), Math.abs(reversedArea), 1e-6, `${label}: reversal preserves the filled area`);
  }
});

it("arc().padRadius(r) scales the gap, and therefore each rim’s trimming, by r", () => {
  const options = {innerRadius: 50, outerRadius: 100, startAngle: 0, endAngle: 0.5, padAngle: 0.1, padRadius: 80};
  const model = paddedSector(options);
  const contour = contourOf(options);
  const outer = rimArcs(contour, 100);
  const inner = rimArcs(contour, 50);

  // gap = 80 · sin(0.05), independent of the sector’s corner distance.
  assertClose(model.gap, 80 * Math.sin(0.05), 1e-12, "custom padding gap");
  assertClose(Math.abs(outer[0].sweep), 0.5 - 2 * Math.asin(model.gap / 100), 1e-9, "outer retained arc");
  assertClose(Math.abs(inner[0].sweep), 0.5 - 2 * Math.asin(model.gap / 50), 1e-9, "inner retained arc");
  assert.ok(Math.abs(inner[0].sweep) < Math.abs(outer[0].sweep), "inner rim again keeps less arc");
  assertClosed(contour, "custom pad radius");
});
