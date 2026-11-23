import array from "./array.js";
import constant from "./constant.js";
import descending from "./descending.js";
import identity from "./identity.js";
import {asin, sin, sqrt, tau} from "./math.js";

export default function() {
  var value = identity,
      sortValues = descending,
      sort = null,
      startAngle = constant(0),
      endAngle = constant(tau),
      padAngle = constant(0),
      minAngle = constant(0),
      innerRadius = constant(0),
      outerRadius = constant(1);

  function pie(data) {
    var i,
        n = (data = array(data)).length,
        j,
        k,
        sum = 0,
        index = new Array(n),
        arcs = new Array(n),
        a0 = +startAngle.apply(this, arguments),
        da = Math.min(tau, Math.max(-tau, endAngle.apply(this, arguments) - a0)),
        a1,
        p = Math.min(Math.abs(da) / n, padAngle.apply(this, arguments)),
        pa = p * (da < 0 ? -1 : 1),
        ma = Math.max(0, +minAngle.apply(this, arguments)),
        v;

    for (i = 0; i < n; ++i) {
      if ((v = arcs[index[i] = i] = +value(data[i], i, data)) > 0) {
        sum += v;
      }
    }

    // Optionally sort the arcs by previously-computed values or by data.
    if (sortValues != null) index.sort(function(i, j) { return sortValues(arcs[i], arcs[j]); });
    else if (sort != null) index.sort(function(i, j) { return sort(data[i], data[j]); });

    // Enforce a minimum visible inner-edge angle on the positive sectors?
    // The visible angle is the inner arc actually drawn by the arc generator
    // with the default pad radius and no corner radius; see arc.js.
    if (ma > 0 && sum > 0) {
      var r0 = new Array(n),
          r1 = new Array(n),
          values = arcs.slice(),
          sign = da < 0 ? -1 : 1,
          span = Math.abs(da),
          m = 0,
          step,
          pad;

      for (i = 0; i < n; ++i) {
        r0[i] = +innerRadius(data[i], i, data);
        r1[i] = +outerRadius(data[i], i, data);
        if (values[i] > 0) ++m;
      }

      // The angular extent removed from a sector’s inner edge by the padding,
      // 2·asin(rp/r0·sin(p/2)), where rp = sqrt(r0² + r1²) is the default
      // pad radius. A zero inner radius has no inner edge to clip.
      function reduction(i, padAngle) {
        if (!(r0[i] > 0) || !(padAngle > 0)) return 0;
        var rp = sqrt(r0[i] * r0[i] + r1[i] * r1[i]);
        return 2 * asin(rp / r0[i] * sin(padAngle / 2));
      }

      // Water-filling for a candidate pad angle. Each positive sector gets a
      // visible inner arc w: small sectors are promoted to the floor while the
      // rest share the remaining inner angle in proportion to value. The
      // sector spans are w plus the inner-edge clipping, and the non-positive
      // slots occupy a single pad wedge each. Returns the visible angles, or
      // null if the floor cannot be honored for every positive sector.
      function fill(padAngle) {
        var budget = span - (n - m) * padAngle,
            angle = new Array(n),
            done = new Array(n),
            active = m,
            avail,
            vsum = sum,
            q,
            promoted,
            i2;

        for (i2 = 0; i2 < n; ++i2) {
          if (values[i2] > 0) budget -= reduction(i2, padAngle);
        }
        if (!(budget >= ma * m)) return null;

        avail = budget;

        while (active > 0) {
          q = avail / vsum;
          promoted = false;
          for (i2 = 0; i2 < n; ++i2) {
            if (!done[i2] && values[i2] > 0 && values[i2] * q < ma) {
              angle[i2] = ma;
              done[i2] = true;
              avail -= ma;
              vsum -= values[i2];
              --active;
              promoted = true;
            }
          }
          if (!promoted) break;
        }

        if (active > 0) {
          q = avail / vsum;
          for (i2 = 0; i2 < n; ++i2) {
            if (!done[i2] && values[i2] > 0) angle[i2] = values[i2] * q;
          }
        }

        return angle;
      }

      if (p < 0) p = 0;

      // Prefer the caller-specified pad angle; otherwise use the largest
      // uniform pad angle for which the water-filled layout still preserves
      // the minimum visible angle.
      if (fill(p) != null) {
        pad = p;
      } else if (fill(0) == null) {
        // Even with no padding the sectors cannot keep the floor: split the
        // sweep equally between the positive sectors, with no gaps at all.
        pad = 0;
      } else {
        var lo = 0, hi = p;
        for (k = 0; k < 40; ++k) {
          var mid = (lo + hi) / 2;
          if (fill(mid) != null) lo = mid;
          else hi = mid;
        }
        pad = lo;
      }

      p = pad;
      pa = pad * sign;

      var filled = fill(pad);

      if (filled == null) {
        // Tightest case: the positive sectors share the whole sweep equally.
        step = span / m;
        for (i = 0; i < n; ++i) {
          arcs[i] = values[i] > 0 ? step : 0;
        }
      } else {
        for (i = 0; i < n; ++i) arcs[i] = filled[i] || 0;
      }

      // Lay out the slots in the selected (sorted) order so that they tile
      // the sweep from the start angle in the requested direction. Positive
      // sectors span their visible inner arc plus the inner-edge clipping;
      // non-positive slots occupy a single pad wedge.
      for (i = 0; i < n; ++i, a0 = a1) {
        j = index[i], v = values[j];
        if (v > 0) {
          a1 = a0 + sign * (arcs[j] + reduction(j, pad));
        } else {
          a1 = a0 + pa;
        }
        arcs[j] = {
          data: data[j],
          index: i,
          value: v,
          startAngle: a0,
          endAngle: a1,
          padAngle: p
        };
      }

      return arcs;
    }

    // Compute the arcs! They are stored in the original data's order.
    for (i = 0, k = sum ? (da - n * pa) / sum : 0; i < n; ++i, a0 = a1) {
      j = index[i], v = arcs[j], a1 = a0 + (v > 0 ? v * k : 0) + pa, arcs[j] = {
        data: data[j],
        index: i,
        value: v,
        startAngle: a0,
        endAngle: a1,
        padAngle: p
      };
    }

    return arcs;
  }

  pie.value = function(_) {
    return arguments.length ? (value = typeof _ === "function" ? _ : constant(+_), pie) : value;
  };

  pie.sortValues = function(_) {
    return arguments.length ? (sortValues = _, sort = null, pie) : sortValues;
  };

  pie.sort = function(_) {
    return arguments.length ? (sort = _, sortValues = null, pie) : sort;
  };

  pie.startAngle = function(_) {
    return arguments.length ? (startAngle = typeof _ === "function" ? _ : constant(+_), pie) : startAngle;
  };

  pie.endAngle = function(_) {
    return arguments.length ? (endAngle = typeof _ === "function" ? _ : constant(+_), pie) : endAngle;
  };

  pie.padAngle = function(_) {
    return arguments.length ? (padAngle = typeof _ === "function" ? _ : constant(+_), pie) : padAngle;
  };

  pie.minAngle = function(_) {
    return arguments.length ? (minAngle = typeof _ === "function" ? _ : constant(+_), pie) : minAngle;
  };

  pie.innerRadius = function(_) {
    return arguments.length ? (innerRadius = typeof _ === "function" ? _ : constant(+_), pie) : innerRadius;
  };

  pie.outerRadius = function(_) {
    return arguments.length ? (outerRadius = typeof _ === "function" ? _ : constant(+_), pie) : outerRadius;
  };

  return pie;
}
