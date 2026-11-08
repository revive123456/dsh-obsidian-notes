/**
 * 思维导图（B1）纯函数测试：树构建、布局、分支源码区间。
 * renderNumbered 的行号/偏移护栏在 obsidian-syntax.mjs；这里只测 src/mindmap.js。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = readFileSync(join(root, "src", "mindmap.js"), "utf8");
const mm = new Function(`${code}\nreturn mindMapModule;`)();

const checks = [];
function check(name, cond, extra = "") {
  checks.push({ name, cond });
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
}

const MD = [
  "# 网络连通性",              // 1
  "",                          // 2
  "## 测试工具",               // 3
  "- iperf3",                  // 4
  "  - 带宽",                  // 5
  "  - 抖动",                  // 6
  "- ping",                    // 7
  "",                          // 8
  "## 通过标准 ",              // 9（块引用标记要被剥掉）
  "- 吞吐 ^ok",                // 10
  "",                          // 11
  "```bash",                   // 12
  "# 这不是标题",              // 13
  "- 这不是列表",              // 14
  "```",                       // 15
  "## **粗体** 与 [[笔记B|别名]]", // 16
  "- long " + "x".repeat(100), // 17
].join("\n");

const tree = mm.buildTree(MD, { title: "demo.md" });

check("根节点是笔记名", tree.kind === "root" && tree.text === "demo.md" && tree.line === 0);
check("根直接子节点 = 一级标题（1 个）", tree.children.length === 1, tree.children.map((n) => n.text).join(" | "));
const h1 = tree.children[0];
check("一级标题文本/行号", h1.text === "网络连通性" && h1.line === 1, `${h1.text}@${h1.line}`);
check("## 标题挂在 # 标题下（3 个）", h1.children.length === 3, h1.children.map((n) => n.text).join(" | "));
const [h2, h2b, h3] = h1.children;
check("二级标题文本/行号", h2.text === "测试工具" && h2.line === 3, `${h2.text}@${h2.line}`);
check("列表项文本与行号", h2.children[0].text === "iperf3" && h2.children[0].line === 4,
  `${h2.children[0].text}@${h2.children[0].line}`);
check("嵌套列表（缩进 2）挂在 iperf3 下",
  h2.children[0].children.length === 2
  && h2.children[0].children[0].text === "带宽" && h2.children[0].children[1].text === "抖动");
check("第二个列表项回到标题层（与 iperf3 同级）", h2.children[1].text === "ping" && h2.children[1].line === 7);
check("块引用标记 ^ok 被剥掉、标题尾随空格被去掉",
  h2b.text === "通过标准" && h2b.children[0].text === "吞吐",
  `${h2b.text}: ${JSON.stringify(h2b.children.map((n) => n.text))}`);
check("代码围栏里的 # / - 不算节点", h3.children.length === 1, `第三个标题子节点=${h3.children.length}`);
check("行内标记剥掉：**粗体** 与 [[笔记B|别名]]",
  h3.text === "粗体 与 别名", h3.text);
check("长文本截断到 80 字符以内", [...h3.children[0].text].length <= 80, `len=${[...h3.children[0].text].length}`);
check("endLine：一级标题覆盖到最后一节（16/17 行）",
  h3.endLine === MD.split("\n").length, `${h3.endLine}`);
check("endLine：列表项包含后代行（iperf3 到 6）", h2.children[0].endLine === 6, String(h2.children[0].endLine));

// ── 布局 ────────────────────────────────────────────────────────────────────
const plan = mm.layout(tree);
const nodeCount = (function count(n) { return 1 + n.children.reduce((s, c) => s + count(c), 0); })(tree);
check("布局节点数 = 树节点数", plan.nodes.length === nodeCount, `${plan.nodes.length}/${nodeCount}`);
check("布局边数 = 节点数 - 1", plan.edges.length === nodeCount - 1, `${plan.edges.length}`);
check("布局尺寸为正", plan.width > 0 && plan.height > 0, `${plan.width}x${plan.height}`);
check("x 只由深度决定", plan.nodes.every((n) => n.x === 36 + n.depth * 248), "padX=36, colW=248");
const leaves = plan.nodes.filter((n) => !plan.edges.some((e) => e.from === n.id));
const leafYs = leaves.map((n) => n.y);
check("叶子 y 不重复且递增", new Set(leafYs).size === leafYs.length && leafYs.every((y, i) => i === 0 || y > leafYs[i - 1]),
  JSON.stringify(leafYs));
check("根节点在 x=36、y 居中", plan.byId["n0"].x === 36, JSON.stringify(plan.byId["n0"]));

// ── 分支源码区间 ────────────────────────────────────────────────────────────
const span = mm.branchSpan(MD, h2);
check("branchSpan：iperf3 分支区间覆盖 3–7 行",
  MD.replace(/\r\n/g, "\n").slice(span.start, span.end) === MD.split("\n").slice(2, 7).join("\n"),
  JSON.stringify(MD.split("\n").slice(2, 7).join("\n")));
check("branchSpan：行号区间正确", span.startLine === 3 && span.endLine === 7, `${span.startLine}-${span.endLine}`);
check("branchSpan：text 与 slice 一致", MD.slice(span.start, span.end) === span.text);

// ── 节点上限 ────────────────────────────────────────────────────────────────
const many = Array.from({ length: 50 }, (_, i) => `# H${i}`).join("\n");
const limited = mm.buildTree(many, { maxNodes: 10 });
const countLimited = (function count(n) { return 1 + n.children.reduce((s, c) => s + count(c), 0); })(limited);
check("maxNodes 生效（含根共 10 个）", countLimited === 10, String(countLimited));

const failed = checks.filter((c) => !c.cond);
if (failed.length > 0) {
  console.error(`\n${failed.length} 条思维导图断言失败：${failed.map((c) => c.name).join(" | ")}`);
  process.exit(1);
}
console.log("\n思维导图纯函数断言全部通过 ✔");
