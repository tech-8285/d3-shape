// A diverging stack offset that leaves a configurable gap centered on zero.
//
// The argument is the total gap width in stack units. Positive bands stack
// outward (upward) from the gap’s top edge and negative bands outward
// (downward) from its bottom edge, so both sides start the same distance from
// zero. A width of zero (the default) reproduces stackOffsetDiverging exactly,
// with no gap.
//
// As in stackOffsetDiverging, a point’s thickness is the difference of its
// existing endpoints y1 - y0, not y1 itself: a series that already carries
// offsets keeps the same thickness, and the series array is never reordered —
// only the points of the original band objects, visited in draw order, are
// updated. A zero-thickness point stays at [0, 0]; a missing (NaN) value keeps
// its NaN upper bound as [0, NaN].
export default function(gap) {
  gap = +gap;
  var half = isNaN(gap) || !(gap > 0) ? 0 : gap / 2,
      top0 = half,
      bottom0 = half > 0 ? -half : 0;
  return function(series, order) {
    if (!((n = series.length) > 0)) return;
    for (var i, j = 0, d, dy, yp, yn, n, m = series[order[0]].length; j < m; ++j) {
      for (yp = top0, yn = bottom0, i = 0; i < n; ++i) {
        if ((dy = (d = series[order[i]][j])[1] - d[0]) > 0) {
          d[0] = yp, d[1] = yp += dy;
        } else if (dy < 0) {
          d[1] = yn, d[0] = yn += dy;
        } else {
          d[0] = 0, d[1] = dy;
        }
      }
    }
  };
}
