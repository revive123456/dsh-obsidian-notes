/**
 * 只读预览不显示行号（编辑态 gutter 保留）的展示契约（离线）。
 *
 * 口径：笔记 Dock 的只读预览里看不到行号，但行号节点不能从渲染器里删掉 ——
 * 空源码行要靠它的行高撑住段落间距，思维导图跳行要靠行上的 data-line，
 * 「选中提问」的行号区间走 .dsh-obs-src 偏移、与行号节点无关。
 * 这里钉住三件事：
 *   - 隐藏规则只作用在只读预览容器（.dsh-obs-dock-body .dsh-obs-md）里；
 *   - 预览行号收成零宽 + visibility:hidden（不是 display:none，空行高度不能塌）；
 *   - 编辑态的行号 gutter 不受影响；渲染器仍产出行号节点与 data-line。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  src: readFileSync(join(root, "src", "client.js"), "utf8"),
  lib: readFileSync(join(root, "lib", "client.js"), "utf8"),
};
const markdown = readFileSync(join(root, "src", "markdown.js"), "utf8");

const failures = [];
function check(name, cond, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures.push(name);
}

/** 取 CSS 数组里某条选择器的声明块 */
function ruleOf(text, selector) {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`);
  return re.exec(text)?.[1] ?? "";
}

for (const [label, text] of Object.entries(files)) {
  // 只读预览：收零宽 + 隐藏，保留行高（否则空行挤在一起）
  const lnRule = ruleOf(text, ".dsh-obs-dock-body .dsh-obs-md .dsh-obs-md-ln");
  check(`${label}: 预览行号零宽并隐藏`,
    lnRule.includes("width:0") && lnRule.includes("min-width:0") && lnRule.includes("visibility:hidden"),
    lnRule);
  check(`${label}: 预览行号不用 display:none（空行高度要保留）`, !lnRule.includes("display:none"), lnRule);
  // 行号收走之后，行内不能再留 10px 的列间距
  const rowRule = ruleOf(text, ".dsh-obs-dock-body .dsh-obs-md .dsh-obs-md-row");
  check(`${label}: 预览行不再保留行号列间距`, rowRule.includes("gap:0"), rowRule);
  // 表格行号列整列去掉
  const tlnRule = ruleOf(text, ".dsh-obs-dock-body .dsh-obs-md .dsh-obs-md-tln");
  check(`${label}: 预览表格的行号列隐藏`, tlnRule.includes("display:none"), tlnRule);
  // 编辑态 gutter 必须还在
  const gutterRule = ruleOf(text, ".dsh-obs-editor-gutter");
  check(`${label}: 编辑态行号 gutter 仍可见`,
    gutterRule !== "" && !gutterRule.includes("display:none") && !gutterRule.includes("visibility:hidden"),
    gutterRule);
}

// 渲染器仍产出行号节点与 data-line（跳行 / 空行高度依赖它们）
check("渲染器仍产出 .dsh-obs-md-ln 行号节点", markdown.includes('createElement("span", { className: "dsh-obs-md-ln" }'));
check("渲染器行仍带 data-line", /"data-line": num/.test(markdown));
check("表格仍产出行号格 .dsh-obs-md-tln", markdown.includes('className: "dsh-obs-md-tln"'));

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED: ${failures.join(" | ")}`);
  process.exit(1);
}
console.log("\n预览行号展示契约全部通过 ✔");
