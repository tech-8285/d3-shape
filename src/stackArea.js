import {Path} from "d3-path";
import array from "./array.js";
import constant from "./constant.js";
import orderNone from "./order/none.js";
import {x as pointX, y as pointY} from "./point.js";

function stackValue(d, key) {
  return d[key];
}

function defaultX(d, i) {
  return i;
}

function stackSeries(key) {
  const series = [];
  series.key = key;
  return series;
}

// Treats two numbers as equal at machine-ish precision, so a zero crossing that
// lands on (or infinitesimally near) a sample column does not create a
// zero-width interval or a duplicate vertex.
function near(a, b) {
  return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
}

function signOf(v) {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

// A diverging stacked-area contour generator with a configurable center gap.
//
// Between adjacent sample columns each category’s raw value is treated as a
// linear function of x, so a band’s thickness at any x is the absolute value of
// that function there. Positive bands stack outward from the top edge of the
// center gap; negative bands stack outward from its bottom edge; both sides
// follow the draw order. The total gap width is set with .gap and defaults to
// zero, in which case both sides meet at zero, as in stackOffsetDiverging.
//
// stackArea(data) returns one series per category, in the order of keys() (not
// in draw order). As with stack(), series.key is the category and series.index
// is its position in the draw order, so keys and draw order stay independently
// traceable. Each series is an array of bands; each band is a closed polygon of
// [x, y] points that can be filled directly. A band’s .top and .bottom are its
// upper and lower edges as [x, y] arrays (left to right) and its .sign is +1
// above the gap or -1 below it.
//
// A band that changes sign between two columns collapses to zero thickness on
// each side separately, so its contour is split at every zero crossing instead
// of being drawn across the gap. Breakpoints also include the other categories’
// zero crossings, so a neighbor’s edge follows the true stack boundary even
// when that neighbor never changes side. A missing value (null, undefined or
// NaN, or one rejected by .defined) breaks only that category’s contour: over
// any interval touching the missing sample the category is absent and is not
// given a made-up value, while the other categories keep drawing across their
// own valid intervals. A valid zero is a real value, so a band may taper to
// zero thickness and reappear without crossing the gap.
export default function() {
  var keys = constant([]),
      order = orderNone,
      value = stackValue,
      x = defaultX,
      defined = constant(true),
      gap = 0;

  function stackArea(data) {
    var args = arguments,
        rows = array(data),
        categoryKeys = Array.from(keys.apply(this, args)),
        n = categoryKeys.length,
        m = rows.length,
        i, j, k, p;

    if (n === 0) return [];

    var xs = new Array(m),
        vals = new Array(n),
        known = new Array(n);

    for (j = 0; j < m; ++j) xs[j] = +x(rows[j], j, rows);
    for (i = 0; i < n; ++i) {
      vals[i] = new Array(m);
      known[i] = new Array(m);
      for (j = 0; j < m; ++j) {
        var raw = value(rows[j], categoryKeys[i], j, rows),
            v = raw == null ? NaN : +raw;
        known[i][j] = !!defined(rows[j], j, rows) && raw != null && !isNaN(v);
        vals[i][j] = known[i][j] ? v : NaN;
      }
    }

    // Resolve the draw order through the existing stack order functions by
    // giving each category a series of [0, value] points, the shape they
    // expect. The returned array stays in key order; only .index reflects the
    // draw order, so keys, order and data bindings are never scrambled.
    var sz = new Array(n);
    for (i = 0; i < n; ++i) sz[i] = stackSeries(categoryKeys[i]);
    for (j = 0; j < m; ++j) {
      for (i = 0; i < n; ++i) {
        (sz[i][j] = [0, known[i][j] ? vals[i][j] : NaN]).data = rows[j];
      }
    }
    var ord = array(order(sz));

    var series = new Array(n);
    for (i = 0; i < n; ++i) series[i] = stackSeries(categoryKeys[i]);
    for (i = 0; i < n; ++i) series[ord[i]].index = i;

    // With fewer than two columns there is no interval to fill.
    if (m < 2) return series;

    var half = isNaN(gap) || !(gap > 0) ? 0 : gap / 2;

    // present[j][i] is true when category i is known at both endpoints of
    // column interval j; otherwise it is absent there and contributes no
    // thickness. This is per-category: one category’s missing sample does not
    // break the others.
    var present = new Array(m - 1);
    for (j = 0; j + 1 < m; ++j) {
      present[j] = new Array(n);
      for (i = 0; i < n; ++i) present[j][i] = known[i][j] && known[i][j + 1];
    }

    // Values of every category at x=q as seen from column interval j, plus the
    // stacking boundaries. Missing categories contribute 0; a category whose
    // zero crossing sits exactly at q reads as 0.
    function snapshot(q, j, cross) {
      var lo = xs[j], hi = xs[j + 1], vs = new Array(n), t, c;
      if (near(q, lo)) {
        for (c = 0; c < n; ++c) vs[c] = present[j][c] ? vals[c][j] : 0;
      } else if (near(q, hi)) {
        for (c = 0; c < n; ++c) vs[c] = present[j][c] ? vals[c][j + 1] : 0;
      } else {
        t = (q - lo) / (hi - lo);
        for (c = 0; c < n; ++c) {
          vs[c] = present[j][c] ? vals[c][j] * (1 - t) + vals[c][j + 1] * t : 0;
        }
      }
      for (c = 0; c < cross.length; ++c) vs[cross[c]] = 0;

      // pos[i] is the inner (gap-side) edge of category i’s positive band and
      // neg[i] of its negative band, in draw order outward from each gap edge.
      var pos = new Array(n), neg = new Array(n), yp = half, yn = -half, o, ci;
      for (o = 0; o < n; ++o) {
        ci = ord[o];
        pos[ci] = yp, neg[ci] = yn;
        if (vs[ci] > 0) yp += vs[ci];
        else if (vs[ci] < 0) yn += vs[ci];
      }
      return {x: q, values: vs, pos: pos, neg: neg};
    }

    // Elementary sub-intervals over the whole x domain, each owned by one
    // column interval. Splitting at every category’s zero crossing makes every
    // category linear with a constant sign on each sub-interval.
    var subs = [];
    for (j = 0; j + 1 < m; ++j) {
      var lo = xs[j], hi = xs[j + 1];
      if (near(lo, hi)) continue;

      var lx = [lo, hi], cross = [[], []];
      for (i = 0; i < n; ++i) {
        if (present[j][i]) {
          var a = vals[i][j], b = vals[i][j + 1];
          if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
            lx.push(lo + a / (a - b) * (hi - lo));
            cross.push([i]);
          }
        }
      }

      // Sort ascending and merge coincident breakpoints (union of crossings).
      var pi = lx.map(function(_, idx) { return idx; })
          .sort(function(q, r) { return lx[q] - lx[r]; });
      var bx = [], bc = [];
      for (k = 0; k < pi.length; ++k) {
        var ii = pi[k];
        if (bx.length && near(lx[ii], bx[bx.length - 1])) {
          bc[bc.length - 1] = bc[bc.length - 1].concat(cross[ii]);
        } else {
          bx.push(lx[ii]);
          bc.push(cross[ii].slice());
        }
      }

      var snaps = new Array(bx.length);
      for (k = 0; k < bx.length; ++k) snaps[k] = snapshot(bx[k], j, bc[k]);

      for (k = 0; k + 1 < bx.length; ++k) {
        if (near(bx[k], bx[k + 1])) continue;
        subs.push({j: j, x0: bx[k], x1: bx[k + 1], s0: snaps[k], s1: snaps[k + 1]});
      }
    }

    subs.sort(function(q, r) { return q.x0 - r.x0; });

    // Appends the top and bottom vertex of category i at snapshot s for a band
    // of the given sign, skipping an exact repeat of the previous vertex.
    function vertex(run, i, s, v, sg) {
      var inner = sg > 0 ? s.pos[i] : s.neg[i],
          outer = inner + v,
          top = [s.x, Math.max(inner, outer)],
          bottom = [s.x, Math.min(inner, outer)],
          last = run.top[run.top.length - 1];
      if (last && near(last[0], top[0]) && near(last[1], top[1])) return;
      run.top.push(top);
      run.bottom.push(bottom);
    }

    // Builds category i’s bands by merging consecutive sub-intervals that keep
    // the same sign. Each sub-interval contributes both endpoints, evaluated in
    // its own column interval, so a neighbor whose presence or stack boundary
    // jumps at a column yields an explicit vertical edge, while equal endpoints
    // collapse to one vertex.
    function bandsFor(i) {
      var bands = [], run = null, lastX = NaN, prevEnd = NaN;
      for (var k = 0; k < subs.length; ++k) {
        var sub = subs[k];
        if (!present[sub.j][i]) { flush(); continue; }
        var a0 = sub.s0.values[i], a1 = sub.s1.values[i],
            sg = a0 !== 0 ? signOf(a0) : signOf(a1);
        if (sg === 0) { flush(); continue; }
        // A zero-thickness vertex inside the domain means the band vanishes;
        // start a fresh band on the far side so it disappears and reappears
        // rather than pinching into a self-touching polygon.
        if (!run || run.sign !== sg || !near(lastX, sub.x0) || prevEnd === 0) {
          flush();
          run = {sign: sg, top: [], bottom: []};
        }
        vertex(run, i, sub.s0, a0, sg);
        vertex(run, i, sub.s1, a1, sg);
        lastX = sub.x1;
        prevEnd = a1;
      }
      flush();
      return bands;

      function flush() {
        if (!run) return;
        if (run.top.length > 1) {
          var polygon = run.top.concat(run.bottom.slice().reverse());
          polygon.top = run.top;
          polygon.bottom = run.bottom;
          polygon.sign = run.sign;
          polygon.x0 = run.top[0][0];
          polygon.x1 = run.top[run.top.length - 1][0];
          bands.push(polygon);
        }
        run = null;
      }
    }

    for (i = 0; i < n; ++i) {
      var bands = bandsFor(i);
      for (p = 0; p < bands.length; ++p) series[i].push(bands[p]);
    }

    return series;
  }

  stackArea.keys = function(_) {
    return arguments.length ? (keys = typeof _ === "function" ? _ : constant(Array.from(_)), stackArea) : keys;
  };

  stackArea.value = function(_) {
    return arguments.length ? (value = typeof _ === "function" ? _ : constant(+_), stackArea) : value;
  };

  stackArea.order = function(_) {
    return arguments.length ? (order = _ == null ? orderNone : typeof _ === "function" ? _ : constant(Array.from(_)), stackArea) : order;
  };

  stackArea.x = function(_) {
    return arguments.length ? (x = typeof _ === "function" ? _ : constant(+_), stackArea) : x;
  };

  stackArea.defined = function(_) {
    return arguments.length ? (defined = typeof _ === "function" ? _ : constant(!!_), stackArea) : defined;
  };

  stackArea.gap = function(_) {
    return arguments.length ? (gap = _ == null ? 0 : +_, stackArea) : gap;
  };

  return stackArea;
}

// Renders the bands of one series (as returned by stackArea) to an SVG path
// string, or to a canvas-like context if one is set. Each band becomes one
// closed subpath; stackArea has already split the bands, so nothing is merged
// or reordered here.
export function stackAreaPath() {
  var x = pointX,
      y = pointY,
      context = null,
      digits = 3;

  function path(series) {
    var output = context || new Path(digits),
        b, nb = series.length, p, np;

    for (b = 0; b < nb; ++b) {
      var band = series[b];
      for (p = 0, np = band.length; p < np; ++p) {
        var px = +x(band[p], p, band),
            py = +y(band[p], p, band);
        if (p === 0) output.moveTo(px, py);
        else output.lineTo(px, py);
      }
      if (np) output.closePath();
    }

    return context ? null : output + "" || null;
  }

  path.x = function(_) {
    return arguments.length ? (x = typeof _ === "function" ? _ : constant(+_), path) : x;
  };

  path.y = function(_) {
    return arguments.length ? (y = typeof _ === "function" ? _ : constant(+_), path) : y;
  };

  path.context = function(_) {
    return arguments.length ? (_ == null ? context = null : context = _, path) : context;
  };

  path.digits = function(_) {
    if (!arguments.length) return digits;
    if (_ == null) {
      digits = null;
    } else {
      const d = Math.floor(_);
      if (!(d >= 0)) throw new RangeError(`invalid digits: ${_}`);
      digits = d;
    }
    return path;
  };

  return path;
}
