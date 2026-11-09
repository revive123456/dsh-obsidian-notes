/**
 * 关系图谱纯函数测试：力导向布局（确定性/边界/截断）+ 局部子图。
 * host 侧数据构建见 test/graph-host.mjs。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = readFileSync(join(root, "src", "graph.js"), "utf8");
const graphModule = new Function(`${code}\nreturn graphModule;`)();

const checks = [];
function check(name, cond, extra = "") {
  checks.push({ name, cond });
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
}

const nodes = [
  { id: "note:A", kind: "note", label: "A", path: "A.md" },
  { id: "note:B", kind: "note", label: "B", path: "B.md" },
  { id: "note:C", kind: "note", label: "C", path: "C.md" },
  { id: "tag:x", kind: "tag", label: "#x" },
];
const edges = [
  { source: "note:A", target: "note:B" },
  { source: "note:A", target: "note:C" },
  { source: "note:B", target: "note:C" },
  { source: "note:A", target: "tag:x" },
];

// ── 布局 ────────────────────────────────────────────────────────────────────
{
  const plan = graphModule.layoutGraph(nodes, edges, { seed: 7, iterations: 120, width: 800, height: 500 });
  check("布局节点数不变", plan.nodes.length === 4, String(plan.nodes.length));
  check("坐标全部有限", plan.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  check("坐标落在画布内（含 padding）", plan.nodes.every((n) => n.x >= 0 && n.x <= 800 && n.y >= 0 && n.y <= 500),
    JSON.stringify(plan.nodes.map((n) => [Math.round(n.x), Math.round(n.y)])));
  check("度数正确", JSON.stringify(plan.nodes.map((n) => n.degree).sort()) === JSON.stringify([1, 2, 2, 3]),
    JSON.stringify(plan.nodes.map((n) => n.degree)));
  check("图尺寸等于请求尺寸", plan.width === 800 && plan.height === 500);
  const plan2 = graphModule.layoutGraph(nodes, edges, { seed: 7, iterations: 120, width: 800, height: 500 });
  check("同 seed 布局可复现", JSON.stringify(plan.nodes.map((n) => [n.x, n.y])) === JSON.stringify(plan2.nodes.map((n) => [n.x, n.y])));
  const plan3 = graphModule.layoutGraph(nodes, edges, { seed: 8, iterations: 120, width: 800, height: 500 });
  check("不同 seed 布局不同", JSON.stringify(plan.nodes.map((n) => [n.x, n.y])) !== JSON.stringify(plan3.nodes.map((n) => [n.x, n.y])));
}

// ── 截断 ────────────────────────────────────────────────────────────────────
{
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, kind: "note", label: `n${i}` }));
  const manyEdges = many.slice(0, 20).map((_, i) => ({ source: "n0", target: `n${i + 1}` }));
  const plan = graphModule.layoutGraph(many, manyEdges, { seed: 1, iterations: 30, maxNodes: 10 });
  check("超过 maxNodes 时截断并按度数保留", plan.nodes.length === 10 && plan.truncated === true, `nodes=${plan.nodes.length} truncated=${plan.truncated}`);
  check("截断后包含中心节点 n0", plan.nodes.some((n) => n.id === "n0"));
}

// ── 局部子图 ────────────────────────────────────────────────────────────────
{
  const graph = { nodes, edges };
  const one = graphModule.localSubgraph(graph, "note:A", 1);
  check("局部 1 跳：A + 直接邻居", one.found && one.nodes.length === 4 && one.edges.length === 4,
    `${one.nodes.length} 节点 / ${one.edges.length} 边`);
  const zero = graphModule.localSubgraph(graph, "note:A", 0);
  check("局部 0 跳：只有中心节点", zero.nodes.length === 1 && zero.nodes[0].id === "note:A");
  const missing = graphModule.localSubgraph(graph, "note:missing", 2);
  check("中心不存在时 found=false", missing.found === false && missing.nodes.length === 0);
  const local = graphModule.localSubgraph(graph, "note:C", 1);
  check("局部子图只保留内部边", local.edges.every((e) => local.nodes.some((n) => n.id === e.source) && local.nodes.some((n) => n.id === e.target)));
}

// ── 客户端兜底构建（旧 host 无 /graph 路由时用）─────────────────────────────
{
  const notes = [
    { path: "a.md", links: ["B", "missing"], tags: ["alpha"] },
    { path: "sub/b.md", links: ["a"], tags: [] },
    { path: "sub/c.md", links: [], tags: ["beta"] },
  ];
  const built = graphModule.buildGraphFromNotes(notes);
  const ids = new Set(built.nodes.map((n) => n.id));
  const keys = new Set(built.edges.map((e) => `${e.source}->${e.target}`));
  check("兜底构建：3 篇笔记 + 2 个标签", built.stats.notes === 3 && built.stats.tags === 2 && ids.has("note:sub/b.md") && ids.has("tag:alpha"),
    JSON.stringify(built.stats));
  check("兜底构建：链接解析（B → sub/b.md，反向 [[a]]）",
    keys.has("note:a.md->note:sub/b.md") && keys.has("note:sub/b.md->note:a.md"), [...keys].join(" | "));
  check("兜底构建：未解析链接计数且不产生幽灵节点",
    built.stats.unresolved === 1 && ![...ids].some((id) => id.includes("missing")));
  check("兜底构建：标签边", keys.has("note:a.md->tag:alpha") && keys.has("note:sub/c.md->tag:beta"));
  check("兜底构建：source 标记为 client", built.stats.source === "client");
  check("extractTags：frontmatter + 正文标签，代码里的不算",
    JSON.stringify(graphModule.extractTags("正文 #gamma `#notatag` \n```\n#infence\n```", { tags: "[alpha, beta]" }).sort())
      === JSON.stringify(["alpha", "beta", "gamma"]),
    JSON.stringify(graphModule.extractTags("正文 #gamma `#notatag` \n```\n#infence\n```", { tags: "[alpha, beta]" })));
}

// ── 局部跳数（与 Obsidian local graph depth 1–5 对齐）────────────────────────
{
  const chain = ["A", "B", "C", "D", "E", "F"].map((name) => ({ id: `note:${name}`, kind: "note", label: name }));
  const chainEdges = [0, 1, 2, 3, 4].map((i) => ({ source: `note:${"ABCDEF"[i]}`, target: `note:${"ABCDEF"[i + 1]}` }));
  const graph = { nodes: chain, edges: chainEdges };
  const size = (depth) => graphModule.localSubgraph(graph, "note:A", depth).nodes.length;
  check("局部跳数：1 跳 = 中心 + 直接邻居", size(1) === 2, String(size(1)));
  check("局部跳数：2 跳", size(2) === 3, String(size(2)));
  check("局部跳数：3 跳", size(3) === 4, String(size(3)));
  check("局部跳数：5 跳覆盖整条链", size(5) === 6, String(size(5)));
}

// ── 聚焦模式镜头（全库不裁剪，视口推近当前笔记 + 一跳邻居）─────────────────
{
  // 手摆坐标，让断言能写成确定数字：A 为中心，B/C 是一跳邻居，D 离得很远
  const plan = {
    width: 1000,
    height: 800,
    nodes: [
      { id: "note:A", x: 500, y: 300 },
      { id: "note:B", x: 400, y: 300 },
      { id: "note:C", x: 600, y: 300 },
      { id: "note:D", x: 900, y: 700 },
    ],
  };
  const focusEdges = [
    { source: "note:A", target: "note:B" },
    { source: "note:A", target: "note:C" },
  ];
  const viewport = { width: 900, height: 560 };
  // 邻居包围盒 x∈[400,600]、y=300，加 80 留白 → 360×160，推近倍数被 maxScale 1.6 封顶
  const framed = graphModule.focusViewport(plan, focusEdges, "note:A", viewport);
  check("聚焦镜头返回有限平移/缩放", framed !== null && Number.isFinite(framed.x) && Number.isFinite(framed.y) && Number.isFinite(framed.s),
    JSON.stringify(framed));
  check("聚焦镜头推近倍数封顶在 maxScale", framed !== null && framed.s === 1.6, String(framed?.s));
  const screenX = (node) => framed.x + node.x * framed.s;
  check("聚焦镜头把当前笔记与邻居的包围盒放在视口正中",
    Math.abs((framed.x + 500 * framed.s) - 450) < 0.001 && Math.abs((framed.y + 300 * framed.s) - 280) < 0.001,
    `bbox 中心=(${framed.x + 500 * framed.s},${framed.y + 300 * framed.s})`);
  check("聚焦不裁剪节点：远处节点被推出视口而不是从布局里删掉",
    plan.nodes.length === 4 && screenX(plan.nodes[3]) > viewport.width,
    `D.x=${screenX(plan.nodes[3])}`);
  const oneHop = graphModule.focusViewport(plan, focusEdges, "note:B", viewport);
  check("聚焦镜头只用一跳邻居（B 的中心是 A，不含 C）",
    oneHop !== null && oneHop.s === 1.6 && Math.abs((oneHop.x + 450 * oneHop.s) - 450) < 0.001,
    JSON.stringify(oneHop));
  check("焦点不在布局里时返回 null（调用方退回整图适配）",
    graphModule.focusViewport(plan, focusEdges, "note:missing", viewport) === null);
  const isolated = { width: 900, height: 560, nodes: [{ id: "note:S", x: 300, y: 200 }] };
  const solo = graphModule.focusViewport(isolated, [], "note:S", viewport);
  check("孤立笔记：镜头居中且不糊脸（封顶 maxScale）",
    solo !== null && solo.s === 1.6
      && Math.abs(solo.x + 300 * solo.s - 450) < 0.001 && Math.abs(solo.y + 200 * solo.s - 280) < 0.001,
    JSON.stringify(solo));
  const capped = graphModule.focusViewport(plan, focusEdges, "note:A", viewport, { maxScale: 1 });
  check("maxScale 可下调", capped !== null && capped.s === 1, String(capped?.s));
}

const failed = checks.filter((c) => !c.cond);
if (failed.length > 0) {
  console.error(`\n${failed.length} 条图谱布局断言失败：${failed.map((c) => c.name).join(" | ")}`);
  process.exit(1);
}
console.log("\n关系图谱布局断言全部通过 ✔");
