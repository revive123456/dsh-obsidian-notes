/**
 * 关系图谱「聚焦」按钮的界面契约（离线）。
 *
 * 事故现场：分段控件 全库/局部/聚焦 里，「聚焦」的选中态写死成 false，点击又把
 * mode 切成 local —— 于是点「聚焦」和点「局部」最后都亮在「局部」上。
 * 现在的口径：聚焦是独立第三模式（保留全库，镜头推近当前笔记 + 一跳邻居），
 * 选中态只属于它自己；没有当前笔记时局部/聚焦一起回退全库。
 * 镜头几何由 src/graph.js 的 focusViewport 负责，数字断言在 test/graph-layout.mjs。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  src: readFileSync(join(root, "src", "client.js"), "utf8"),
  lib: readFileSync(join(root, "lib", "client.js"), "utf8"),
};

const failures = [];
function check(name, cond, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures.push(name);
}

for (const [label, text] of Object.entries(files)) {
  check(`${label}: 聚焦按钮的选中态绑定 mode === "focus"`,
    text.includes('modeButton(t("graphFocus"), mode === "focus"'));
  check(`${label}: 点聚焦进入 focus 模式（不再切到 local）`,
    /if \(mode === "focus"\) setFitKey\(\(v\) => v \+ 1\);\s*else setMode\("focus"\)/.test(text));
  check(`${label}: 聚焦模式用 graphModule.focusViewport 摆镜头`,
    text.includes("graphModule.focusViewport(plan, shown.edges, focusId"));
  check(`${label}: 局部/聚焦失去中心时回退全库`,
    text.includes('!localAvailable && (mode === "local" || mode === "focus")') && text.includes('setMode("global")'));
  check(`${label}: 全库 ↔ 聚焦切换不重跑布局（共用同一份全库数据）`,
    text.includes("const fullGraph = useMemo(") && text.includes("return fullGraph;"));
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED: ${failures.join(" | ")}`);
  process.exit(1);
}
console.log("\n关系图谱聚焦按钮契约全部通过 ✔");
