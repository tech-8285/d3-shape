import assert from "node:assert";
import {it, describe} from "vitest";
import {line, curveMonotoneX, curveMonotoneY} from "d3-shape";
import {assertPathEqual} from "../asserts.js";

// 折线编辑器使用 Steffen（1990）单调三次插值为间距不均的轮廓生成描边。
// 本文件只验证描边几何：接点切向由样点的实际间距与 Steffen 的局部斜率限制决定，
// 并区分若干同样穿过全部样点、也都不越过包络的候选曲线。

// ---------------------------------------------------------------------------
// 测试基础设施：记录 canvas 风格路径指令，独立于 d3-path 的字符串实现。
// ---------------------------------------------------------------------------

function pathContext() {
  const commands = [];
  return {
    commands,
    moveTo(x, y) { commands.push(["M", +x, +y]); },
    lineTo(x, y) { commands.push(["L", +x, +y]); },
    bezierCurveTo(x1, y1, x2, y2, x, y) { commands.push(["C", +x1, +y1, +x2, +y2, +x, +y]); },
    closePath() { commands.push(["Z"]); }
  };
}

function stroke(points, curve = curveMonotoneX) {
  const context = pathContext();
  const c = curve(context);
  c.areaStart();
  c.lineStart();
  for (const [x, y] of points) c.point(+x, +y);
  c.lineEnd();
  c.areaEnd();
  return context.commands;
}

// 拆成逐段几何（直线段或三次 Bézier 段）。
function segments(commands) {
  let start = null;
  const out = [];
  for (const command of commands) {
    if (command[0] === "M") {
      start = [command[1], command[2]];
    } else if (command[0] === "L") {
      out.push({p0: start, p1: [command[1], command[2]], line: true});
      start = [command[1], command[2]];
    } else if (command[0] === "C") {
      out.push({p0: start, c1: [command[1], command[2]], c2: [command[3], command[4]], p1: [command[5], command[6]]});
      start = [command[5], command[6]];
    }
  }
  return out;
}

function pointAt(segment, u) {
  if (segment.line) {
    return [
      segment.p0[0] + (segment.p1[0] - segment.p0[0]) * u,
      segment.p0[1] + (segment.p1[1] - segment.p0[1]) * u
    ];
  }
  const v = 1 - u;
  return [
    v * v * v * segment.p0[0] + 3 * v * v * u * segment.c1[0] + 3 * v * u * u * segment.c2[0] + u * u * u * segment.p1[0],
    v * v * v * segment.p0[1] + 3 * v * v * u * segment.c1[1] + 3 * v * u * u * segment.c2[1] + u * u * u * segment.p1[1]
  ];
}

// 均匀密采整条描边（每段同样多的点，参数 u ∈ [0,1]）。
function sample(commands, perSegment = 48) {
  const out = [];
  for (const segment of segments(commands)) {
    for (let k = 0; k < perSegment; ++k) out.push(pointAt(segment, k / perSegment));
    out.push(segment.p1);
  }
  return out;
}

// 每段首末接点处的 dy/dx；纵向停滞段（x 为常量）返回 null，因为该斜率没有定义。
function endpointSlopes(commands) {
  let start = null;
  const out = [];
  for (const command of commands) {
    if (command[0] === "M") start = [command[1], command[2]];
    else if (command[0] === "L") {
      const dx = command[1] - start[0];
      const slope = dx === 0 ? null : (command[2] - start[1]) / dx;
      out.push([slope, slope]);
      start = [command[1], command[2]];
    } else if (command[0] === "C") {
      const dx0 = command[1] - start[0], dx1 = command[5] - command[3];
      out.push([
        dx0 === 0 ? null : (command[2] - start[1]) / dx0,
        dx1 === 0 ? null : (command[6] - command[4]) / dx1
      ]);
      start = [command[5], command[6]];
    }
  }
  return out;
}

function closeTo(actual, expected, eps = 1e-9) {
  assert(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(actual), Math.abs(expected)),
    `expected ${actual} to be within ${eps} (relative) of ${expected}`);
}

// ---------------------------------------------------------------------------
// 独立参照实现（与 src/curve/monotone.js 的流式写法不同的批量公式），
// 仅在测试内使用，用来生成“约定切向”和无约束对照曲线。
// ---------------------------------------------------------------------------

function secantSlopes(points) {
  const slopes = [];
  for (let i = 0; i < points.length - 1; ++i) {
    const h = points[i + 1][0] - points[i][0];
    assert(h !== 0, "参照实现只接受无停滞的样点序列");
    slopes.push((points[i + 1][1] - points[i][1]) / h);
  }
  return slopes;
}

const signOf = x => x < 0 ? -1 : x > 0 ? 1 : 0;

// Steffen 局部斜率限制：内部接点
//   m_i = (sign(s0)+sign(s1))·min(|s0|, |s1|, ½|p|)，异号时取 0；
// 端点用单侧公式 (3s − m邻居)/2。注意端点邻居必须是已经受限后的接点切向。
function steffenTangents(points) {
  const secants = secantSlopes(points);
  const n = points.length;
  const tangents = new Array(n);
  for (let i = 1; i < n - 1; ++i) {
    const h0 = points[i][0] - points[i - 1][0];
    const h1 = points[i + 1][0] - points[i][0];
    const s0 = secants[i - 1], s1 = secants[i];
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    tangents[i] = (signOf(s0) + signOf(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  tangents[0] = (3 * secants[0] - tangents[1]) / 2;
  tangents[n - 1] = (3 * secants[n - 2] - tangents[n - 2]) / 2;
  return tangents;
}

// 无约束 Hermite 对照：内部接点直接取相邻割线斜率的算术平均，不做 Steffen 限制。
// 它同样穿过所有样点、在本数据上也不越过样点包络，但会在段内产生额外折返。
function unconstrainedTangents(points) {
  const secants = secantSlopes(points);
  const tangents = [secants[0]];
  for (let i = 1; i < points.length - 1; ++i) tangents.push((secants[i - 1] + secants[i]) / 2);
  tangents.push(secants[secants.length - 1]);
  return tangents;
}

// 由 Hermite 切向数组发射与 d3 相同约定的 Bézier 指令。
function hermiteStroke(points, tangents) {
  const commands = [["M", points[0][0], points[0][1]]];
  for (let i = 0; i < points.length - 1; ++i) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    const dx = (x1 - x0) / 3;
    commands.push([
      "C",
      x0 + dx, y0 + dx * tangents[i],
      x1 - dx, y1 - dx * tangents[i + 1],
      x1, y1
    ]);
  }
  return commands;
}

// Hermite 三次段 dy/du 的内部驻点（解析求根，避免密采漏检）。
function interiorStationaryRoots(x0, y0, x1, y1, m0, m1) {
  const h = x1 - x0, dy = y1 - y0;
  const a = -2 * dy + h * (m0 + m1);
  const b = 3 * dy - h * (2 * m0 + m1);
  const c = h * m0;
  let roots;
  if (Math.abs(a) < 1e-14) {
    roots = Math.abs(b) < 1e-14 ? [] : [-c / b];
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];
    const r = Math.sqrt(discriminant);
    roots = [(-b - r) / (2 * a), (-b + r) / (2 * a)];
  }
  return roots.filter(u => u > 1e-9 && u < 1 - 1e-9);
}

// 统计一组 Hermite 切向下，每段沿行进方向发生折返的次数。
// 判据：驻点之后的纵轴变化与该段两端约定的行进方向相反。鼓包恢复到约定方向
// 的那个驻点不算折返——它是在回到约定方向，而不是背离它。
function countReversals(points, tangents) {
  let reversals = 0;
  for (let i = 0; i < points.length - 1; ++i) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    const direction = signOf(y1 - y0);
    for (const u of interiorStationaryRoots(x0, y0, x1, y1, tangents[i], tangents[i + 1])) {
      const before = pointAtHermite(x0, y0, x1, y1, tangents[i], tangents[i + 1], Math.max(0, u - 0.01))[1];
      const after = pointAtHermite(x0, y0, x1, y1, tangents[i], tangents[i + 1], Math.min(1, u + 0.01))[1];
      if (direction > 0 ? after < before : after > before) ++reversals;
    }
  }
  return reversals;
}

function pointAtHermite(x0, y0, x1, y1, m0, m1, u) {
  const u2 = u * u, u3 = u2 * u, h = x1 - x0;
  return [
    x0 + h * u,
    (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0
      + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * m1
  ];
}

// 折线（分段线性）描边：只含 moveTo/lineTo。
function polylineStroke(points) {
  const commands = [["M", points[0][0], points[0][1]]];
  for (let i = 1; i < points.length; ++i) commands.push(["L", points[i][0], points[i][1]]);
  return commands;
}

// ---------------------------------------------------------------------------
// 测试数据：刻意使用不均匀的横轴间距。
// ---------------------------------------------------------------------------

// B：间距 1,1,1,3,3；最后一段割线很陡（17），最能体现 Steffen 限制与折返差异。
const B = [[0, 0], [1, 1], [2, 1.5], [3, 5], [6, 9], [9, 60]];
// A：间距 1,2,1,8，长间距与短间距相邻。
const A = [[0, 0], [1, 4], [3, 5], [4, 10], [12, 32]];
// C：相邻割线异号，覆盖 Steffen 公式的 “|| 0” 分支（接点切向被压成 0）。
const C = [[0, 0], [1, 3], [3, 1], [6, 4]];
// S：横轴上出现停滞（重复 x），纵向段要按同一约定处理。
const S = [[0, 0], [2, 4], [2, 7], [5, 10], [9, 12]];

const reflect = ([x, y]) => [y, x];
const EPS = 1e-9;

// ===========================================================================
// 1. 接点切向由实际间距与 Steffen 局部斜率限制决定
// ===========================================================================

describe("curveMonotoneX: Steffen 接点切向", () => {
  it("以独立批量公式复算每个接点的 dy/dx（不均匀间距）", () => {
    const expected = steffenTangents(B);
    const actual = endpointSlopes(stroke(B));
    assert.strictEqual(actual.length, B.length - 1);
    for (let i = 0; i < actual.length; ++i) {
      closeTo(actual[i][0], expected[i], EPS);
      closeTo(actual[i][1], expected[i + 1], EPS);
    }
  });

  it("忽略真实间距、按等距重排会得到不同的接点切向", () => {
    const uniform = B.map(([, y], i) => [i, y]); // 同样的 y，间距全部改成 1
    const uneven = endpointSlopes(stroke(B)).flat().filter(v => v !== null);
    const even = endpointSlopes(stroke(uniform)).flat().filter(v => v !== null);
    // 前三个接点的局部间距（均为 1）相同，切向一致；从 x=3 接点起间距差异必须改变切向。
    closeTo(even[0], uneven[0]);
    closeTo(even[2], uneven[2]);
    closeTo(even[4], uneven[4]);
    assert(Math.abs(even[5] - uneven[5]) > 1); // 接点 x=3：2.667（按实际间距）对 3.75（等距）
    assert(Math.abs(even[9] - uneven[9]) > 40); // 末接点：24.167 对 72.5
  });

  it("长间距数据集 A 的接点切向锚定具体数值", () => {
    const slopes = endpointSlopes(stroke(A));
    closeTo(slopes[0][0], 5.5);          // 端点单侧公式，邻居是受限后的 1
    closeTo(slopes[0][1], 1);
    closeTo(slopes[1][0], 1);
    closeTo(slopes[1][1], 1);            // 被 ½|p| 限制钳住，而不是割线 0.5/5 的平均
    closeTo(slopes[2][1], 4.75);
    closeTo(slopes[3][1], 1.75);         // 末端单侧公式 (3·2.75 − 4.75)/2
  });

  it("相邻割线异号时接点切向被压为 0（Steffen 单调性的来源）", () => {
    const slopes = endpointSlopes(stroke(C));
    closeTo(slopes[0][1], 0); // 接点 (1,3)：割线 +3 与 −1 异号
    closeTo(slopes[1][0], 0);
    closeTo(slopes[1][1], 0); // 接点 (3,1)：割线 −1 与 +1 异号
    closeTo(slopes[2][0], 0);
    closeTo(slopes[0][0], 4.5); // 端点：(3·3 − 0)/2
    closeTo(slopes[2][1], 1.5); // 末端：(3·1 − 0)/2
  });

  it("端点切向使用邻居受限后的切向，而不是原始割线", () => {
    // B 的末段割线是 17；若端点误用原始割线，末切向会接近 17，
    // 约定给出的是 (3·17 − 2.667)/2 ≈ 24.167（邻居 m4=2.667 已被钳制）。
    const slopes = endpointSlopes(stroke(B));
    closeTo(slopes[slopes.length - 1][1], (3 * 17 - 8 / 3) / 2);
    assert(Math.abs(slopes[slopes.length - 1][1] - 17) > 7);
    closeTo(slopes[0][0], 1.125); // 首端点：(3·1 − 0.75)/2
  });

  it("整段描边的路径字符串锚定（B 与 A）", () => {
    const l = line().curve(curveMonotoneX);
    assertPathEqual(l(B), "M0,0C0.333,0.375,0.667,0.75,1,1C1.333,1.25,1.667,1.167,2,1.5C2.333,1.833,2.667,4.111,3,5C4,7.667,5,6.333,6,9C7,11.667,8,35.833,9,60");
    assertPathEqual(l(A), "M0,0C0.333,1.833,0.667,3.667,1,4C1.667,4.667,2.333,4.333,3,5C3.333,5.333,3.667,8.417,4,10C6.667,22.667,9.333,27.333,12,32");
  });
});

// ===========================================================================
// 2. 区分同样穿过所有样点、也都不越界的几条曲线
// ===========================================================================

describe("Steffen 描边与其它合规曲线的判别", () => {
  const steffen = stroke(B);
  const rival = hermiteStroke(B, unconstrainedTangents(B));
  const linear = polylineStroke(B);

  it("三条描边都精确穿过每一个样点", () => {
    for (const commands of [steffen, rival, linear]) {
      const parts = segments(commands);
      assert.strictEqual(parts.length, B.length - 1);
      for (let i = 0; i < parts.length; ++i) {
        assert.deepStrictEqual(pointAt(parts[i], 0).map(v => +v.toFixed(12)), B[i].map(v => +v.toFixed(12)));
        assert.deepStrictEqual(pointAt(parts[i], 1).map(v => +v.toFixed(12)), B[i + 1].map(v => +v.toFixed(12)));
      }
    }
  });

  it("三条描边都不越过样点的纵轴包络 [0, 60]", () => {
    const yMin = Math.min(...B.map(([, y]) => y));
    const yMax = Math.max(...B.map(([, y]) => y));
    for (const commands of [steffen, rival, linear]) {
      for (const [x, y] of sample(commands)) {
        assert(y >= yMin - 1e-9 && y <= yMax + 1e-9, `越界点 (${x}, ${y})`);
      }
    }
  });

  it("三条描边的指令序列两两不同", () => {
    assert.notStrictEqual(JSON.stringify(steffen), JSON.stringify(rival));
    assert.notStrictEqual(JSON.stringify(steffen), JSON.stringify(linear));
    assert.notStrictEqual(JSON.stringify(rival), JSON.stringify(linear));
  });

  it("折线在每个内部接点有切向跳跃，Steffen 与无约束曲线在接点处切向连续", () => {
    const secants = secantSlopes(B);
    for (let i = 1; i < secants.length; ++i) {
      assert(Math.abs(secants[i] - secants[i - 1]) > 1e-9); // 折线左右斜率不一致
    }
    // 两条三次曲线的相邻段共享同一接点切向（前段末斜率 == 后段首斜率）。
    for (const commands of [steffen, rival]) {
      const slopes = endpointSlopes(commands);
      for (let i = 0; i < slopes.length - 1; ++i) closeTo(slopes[i][1], slopes[i + 1][0]);
    }
  });

  it("无约束 Hermite 沿段发生额外折返，Steffen 与折线不折返", () => {
    // 无约束曲线在 x∈[3,6] 一段（B 的第 4 段，段索引 3）先升、再降回 y=5、再升：
    // 两个驻点中第一个构成一次违背上行约定的折返（下行鼓包）。
    const rivalTangents = unconstrainedTangents(B);
    assert.strictEqual(countReversals(B, rivalTangents), 1);
    const roots = interiorStationaryRoots(B[3][0], B[3][1], B[4][0], B[4][1], rivalTangents[3], rivalTangents[4]);
    assert.strictEqual(roots.length, 2);
    closeTo(roots[0], 0.3523972, 1e-6);
    closeTo(roots[1], 0.7690981, 1e-6);
    for (const u of roots) closeTo(pointAtHermite(B[3][0], B[3][1], B[4][0], B[4][1], rivalTangents[3], rivalTangents[4], u)[1], 5, 1e-9);

    // Steffen 曲线在所有段上都没有内部驻点：沿行进方向单调，零折返。
    assert.strictEqual(countReversals(B, steffenTangents(B)), 0);
    // 折线段内为直线，同样不可能折返。
    for (const segment of segments(linear)) assert.strictEqual(segment.line, true);
  });

  it("Steffen 是三者中唯一既接点连续又段内无折返的描边", () => {
    const steffenTangentList = steffenTangents(B);
    assert.strictEqual(countReversals(B, steffenTangentList), 0);
    const slopes = endpointSlopes(steffen);
    for (let i = 0; i < slopes.length - 1; ++i) closeTo(slopes[i][1], slopes[i + 1][0]);
    assert(countReversals(B, unconstrainedTangents(B)) > 0);
  });
});

// ===========================================================================
// 3. 横轴 / 纵轴编辑同一轮廓：交换坐标轴后互为镜像
// ===========================================================================

describe("curveMonotoneX 与 curveMonotoneY 的镜像关系", () => {
  function mirrorCommands(commands) {
    return commands.map(([key, ...v]) => {
      if (key === "C") return ["C", v[1], v[0], v[3], v[2], v[5], v[4]];
      if (key === "M" || key === "L") return [key, v[1], v[0]];
      return [key];
    });
  }

  it("纵轴编辑（交换坐标后走 monotoneY）的描边是横轴描边的逐指令镜像", () => {
    for (const points of [A, B, C]) {
      assert.deepStrictEqual(stroke(points.map(reflect), curveMonotoneY), mirrorCommands(stroke(points, curveMonotoneX)));
    }
  });

  it("停滞轮廓的镜像同样成立", () => {
    assert.deepStrictEqual(stroke(S.map(reflect), curveMonotoneY), mirrorCommands(stroke(S, curveMonotoneX)));
  });

  it("同一轮廓直接走 monotoneY 等于镜像数据走 monotoneX 再镜像", () => {
    assert.deepStrictEqual(
      stroke(B, curveMonotoneY),
      mirrorCommands(stroke(B.map(reflect), curveMonotoneX))
    );
  });

  it("镜像后接点切向互为倒数：dx/dy = 1 / (dy/dx)", () => {
    const xSlopes = endpointSlopes(stroke(B, curveMonotoneX));
    const ySlopes = endpointSlopes(stroke(B.map(reflect), curveMonotoneY));
    assert.strictEqual(xSlopes.length, ySlopes.length);
    for (let i = 0; i < xSlopes.length; ++i) {
      closeTo(ySlopes[i][0], 1 / xSlopes[i][0]);
      closeTo(ySlopes[i][1], 1 / xSlopes[i][1]);
    }
  });

  it("镜像描边的密采点集是原描边点集的坐标交换", () => {
    const original = sample(stroke(B, curveMonotoneX));
    const mirrored = sample(stroke(B.map(reflect), curveMonotoneY));
    assert.strictEqual(original.length, mirrored.length);
    for (let i = 0; i < original.length; ++i) {
      closeTo(mirrored[i][0], original[i][1]);
      closeTo(mirrored[i][1], original[i][0]);
    }
  });
});

// ===========================================================================
// 4. 遍历方向与两轴绘图单位：几何曲线不变
// ===========================================================================

describe("遍历方向与绘图单位的不变性", () => {
  it("反向遍历给出同一条几何曲线（密采点次序相反、位置相同）", () => {
    for (const points of [A, B, C]) {
      const forward = sample(stroke(points));
      const backward = sample(stroke([...points].reverse()));
      assert.strictEqual(forward.length, backward.length);
      for (let i = 0; i < forward.length; ++i) {
        const j = forward.length - 1 - i;
        closeTo(backward[j][0], forward[i][0]);
        closeTo(backward[j][1], forward[i][1]);
      }
    }
  });

  it("反向后每个接点的 Steffen 切向保持不变", () => {
    const forward = steffenTangents(B);
    const reversed = steffenTangents([...B].reverse());
    for (let i = 0; i < B.length; ++i) closeTo(reversed[B.length - 1 - i], forward[i]);
  });

  it("分别改变两轴绘图单位（含负刻度）后是同一仿射变换下的曲线", () => {
    const ax = 3.25, ay = -2.5;
    const rescaled = B.map(([x, y]) => [ax * x, ay * y]);
    const original = sample(stroke(B));
    const transformed = sample(stroke(rescaled));
    assert.strictEqual(original.length, transformed.length);
    for (let i = 0; i < original.length; ++i) {
      closeTo(transformed[i][0], ax * original[i][0]);
      closeTo(transformed[i][1], ay * original[i][1]);
    }
  });

  it("纯单位换算不改变接点切向的无量纲值", () => {
    const ax = 7, ay = 2;
    const rescaled = B.map(([x, y]) => [ax * x, ay * y]);
    const original = endpointSlopes(stroke(B)).flat().filter(v => v !== null);
    const transformed = endpointSlopes(stroke(rescaled)).flat().filter(v => v !== null);
    for (let i = 0; i < original.length; ++i) closeTo(transformed[i], (ay / ax) * original[i]);
  });

  it("反向遍历与单位换算可以叠加，几何仍然不变", () => {
    const ax = 0.4, ay = 5;
    const changed = B.map(([x, y]) => [ax * x, ay * y]).reverse();
    const original = sample(stroke(B));
    const transformed = sample(stroke(changed));
    assert.strictEqual(original.length, transformed.length);
    for (let i = 0; i < original.length; ++i) {
      const j = original.length - 1 - i;
      closeTo(transformed[j][0], ax * original[i][0]);
      closeTo(transformed[j][1], ay * original[i][1]);
    }
  });

  it("等比缩放两轴时接点斜率逐点不变", () => {
    const k = 12.8;
    const rescaled = B.map(([x, y]) => [k * x, k * y]);
    const original = endpointSlopes(stroke(B)).flat().filter(v => v !== null);
    const transformed = endpointSlopes(stroke(rescaled)).flat().filter(v => v !== null);
    for (let i = 0; i < original.length; ++i) closeTo(transformed[i], original[i]);
  });
});

// ===========================================================================
// 5. 采样在一个方向停住（重复横坐标）时，实际绘出的整段也遵守约定
// ===========================================================================

describe("横轴停滞（重复 x）的描边", () => {
  it("停滞样点之间是一条纯纵向的三次段，所有控制点 x 相同", () => {
    const parts = segments(stroke(S));
    const vertical = parts[1]; // (2,4) -> (2,7)
    assert.strictEqual(vertical.line, undefined);
    for (const p of [vertical.p0, vertical.c1, vertical.c2, vertical.p1]) assert.strictEqual(p[0], 2);
    assert.strictEqual(vertical.p0[1], 4);
    assert.strictEqual(vertical.p1[1], 7);
  });

  it("停滞段之外仍是普通 Steffen 三次段，接点 dy/dx 与批量公式一致", () => {
    const commands = stroke(S);
    const slopes = endpointSlopes(commands);
    assert.strictEqual(slopes[1][0], null); // 纵向段斜率无定义
    assert.strictEqual(slopes[1][1], null);
    // 停滞点之前的接点切向受到停滞上下文影响，与孤立三点子轮廓并不相同：
    // 实际描边首段两端切向为 [1, 4]，而去掉停滞点的子轮廓给出的端点切向是 2。
    const before = steffenTangents([[0, 0], [2, 4], [5, 10]]);
    closeTo(slopes[0][0], 1);
    closeTo(slopes[0][1], 4);
    closeTo(before[0], 2);
    closeTo(before[1], 2);
    // 恢复行进后的首切向由停滞接点处的 slope3 决定：停滞割线带符号零，
    // s0=∞（纵向）、s1=1、h0=0、h1=3，Steffen 限制给出 m=2；
    // 它与去掉停滞点的独立三点轮廓给出的 1.107 明显不同，说明整段都受停滞约定约束。
    closeTo(slopes[2][0], 2);
    // 末段两个接点与“去掉停滞点”的三点子轮廓一致。
    const after = steffenTangents([[2, 7], [5, 10], [9, 12]]);
    closeTo(slopes[2][1], after[1]); // 0.7857…
    closeTo(slopes[3][1], after[2]); // 0.3571…
  });

  it("停滞段沿纵轴单调行进，不发生折返", () => {
    const vertical = segments(stroke(S))[1];
    let previous = vertical.p0[1];
    for (let k = 1; k <= 40; ++k) {
      const y = pointAt(vertical, k / 40)[1];
      assert(y >= previous - 1e-12);
      previous = y;
    }
    closeTo(previous, 7);
  });

  it("停滞轮廓的完整路径字符串锚定", () => {
    const l = line().curve(curveMonotoneX);
    assertPathEqual(l(S), "M0,0C0.667,0.667,1.333,1.333,2,4C2,4,2,7,2,7C3,9,4,9.214,5,10C6.333,11.048,7.667,11.524,9,12");
  });

  it("完全重合的样点被忽略，描边与去重后的停滞轮廓一致", () => {
    const withDuplicates = [[0, 0], [2, 4], [2, 4], [2, 7], [5, 10], [5, 10], [9, 12]];
    assert.deepStrictEqual(stroke(withDuplicates), stroke(S));
  });

  it("纵轴编辑下的停滞（重复 y）与横轴停滞互为镜像", () => {
    const xStall = stroke(S, curveMonotoneX);
    const yStall = stroke(S.map(reflect), curveMonotoneY);
    const mirror = xStall.map(([key, ...v]) => {
      if (key === "C") return ["C", v[1], v[0], v[3], v[2], v[5], v[4]];
      if (key === "M" || key === "L") return [key, v[1], v[0]];
      return [key];
    });
    assert.deepStrictEqual(yStall, mirror);
    // 纵向停滞在镜像后变成纯横向段：所有控制点的纵坐标恒为停滞点的 x 值 2。
    const horizontal = segments(yStall)[1];
    for (const p of [horizontal.p0, horizontal.c1, horizontal.c2, horizontal.p1]) assert.strictEqual(p[1], 2);
  });
});
