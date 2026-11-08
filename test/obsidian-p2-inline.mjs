/**
 * P2 行内语法（第一批）：~~删除线~~ / ==高亮== / %%注释%% / 反斜杠转义 /
 * <自动链接> 与裸 URL。面板路径（renderNumbered）与偏移记账同时断言。
 *
 * 这些语法在 README 的 "Not rendered" 清单里，属于 P2 阶段；本文件是它们的
 * 验收护栏：渲染结构 + 源码偏移切片必须一致。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = readFileSync(join(root, "src", "markdown.js"), "utf8");

const Fragment = Symbol.for("react.fragment");
function createElement(type, props, ...children) {
  return { type, props: { ...(props ?? {}), children: children.length > 1 ? children : children[0] } };
}
const React = { Fragment, createElement };
const { renderNumbered } = new Function("React", `${code}\nreturn { renderNumbered };`)(React);

const checks = [];
function check(name, cond, extra = "") {
  checks.push({ name, cond });
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
}

const isElement = (n) => n !== null && typeof n === "object" && !Array.isArray(n);
function childrenOf(node) {
  const c = node?.props?.children;
  if (c === undefined || c === null || c === false) return [];
  return Array.isArray(c) ? c : [c];
}
function walk(node, visit) {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  if (typeof node !== "object") { visit(node); return; }
  visit(node);
  for (const c of childrenOf(node)) walk(c, visit);
}
const textOf = (node) => {
  let out = "";
  walk(node, (n) => { if (typeof n === "string") out += n; });
  return out;
};
const findAll = (rootNode, pred) => {
  const out = [];
  walk(rootNode, (n) => { if (isElement(n) && pred(n)) out.push(n); });
  return out;
};
const hasClass = (n, cls) => typeof n?.props?.className === "string" && n.props.className.split(/\s+/).includes(cls);
const localName = (n) => (typeof n?.type === "string" ? n.type : n?.type === Fragment ? "#fragment" : "");

const HANDLERS = {
  onText: () => {},
  onWikilink: () => {},
  assetUrl: (rel) => `/obsidian/file?path=${encodeURIComponent(rel)}`,
};

/** 偏移不变量：每个 span.dsh-obs-src 的切片 === 文本，区间文档序不重叠。 */
function checkOffsets(label, md, tree) {
  const norm = md.replace(/\r\n/g, "\n");
  const spans = findAll(tree, (n) => typeof n?.props?.["data-obs-src"] === "string");
  check(`${label}：偏移 span 类型合法`, spans.every((s) => localName(s) === "span" && hasClass(s, "dsh-obs-src")));
  let prevEnd = -1;
  let bad = "";
  for (const span of spans) {
    const [start, end] = String(span.props["data-obs-src"]).split(",").map(Number);
    const slice = norm.slice(start, end);
    const text = textOf(span);
    if (slice !== text) { bad = `切片=${JSON.stringify(slice)} 文本=${JSON.stringify(text)}`; break; }
    if (start < prevEnd) { bad = `区间乱序 @${start} < ${prevEnd}`; break; }
    prevEnd = end;
  }
  check(`${label}：偏移切片与文本一致且有序`, bad === "", bad);
}

// ── 1. 删除线 / 高亮 ─────────────────────────────────────────────────────────
{
  const md = "~~删除~~ 与 ==高亮== 与 ==**重点**==";
  const tree = renderNumbered(md, HANDLERS);
  const del = findAll(tree, (n) => localName(n) === "del");
  const mark = findAll(tree, (n) => localName(n) === "mark" && hasClass(n, "dsh-obs-mark"));
  const text = textOf(tree);
  check("删除线：渲染为 del", del.length === 1 && textOf(del[0]) === "删除", JSON.stringify(del.map(textOf)));
  check("高亮：渲染为 mark.dsh-obs-mark（2 处）", mark.length === 2, `实测 ${mark.length}`);
  check("高亮：内容走行内解析（**重点** → strong）",
    mark[1] !== undefined && findAll(mark[1], (n) => localName(n) === "strong").length === 1);
  check("标记不外漏：~~ / ==", !text.includes("~~") && !text.includes("=="), JSON.stringify(text));
  checkOffsets("删除线/高亮", md, tree);
}

// ── 2. 行内代码不参与这些语法 ───────────────────────────────────────────────
{
  const md = "`~~x~~` 与 `==y==`";
  const tree = renderNumbered(md, HANDLERS);
  check("代码：code 原样保留，不产生 del/mark",
    textOf(tree).includes("~~x~~") && textOf(tree).includes("==y==")
    && findAll(tree, (n) => localName(n) === "del" || localName(n) === "mark").length === 0,
    JSON.stringify(textOf(tree)));
  checkOffsets("代码", md, tree);
}

// ── 3. %%注释%% 预览不显示 ──────────────────────────────────────────────────
{
  const md = "前面 %%隐藏内容%% 后面";
  const tree = renderNumbered(md, HANDLERS);
  const text = textOf(tree);
  check("注释：内容与标记都不显示", !text.includes("隐藏内容") && !text.includes("%%"), JSON.stringify(text));
  check("注释：前后正文仍在", text.includes("前面") && text.includes("后面"));
  checkOffsets("注释", md, tree);
}

// ── 4. 反斜杠转义 ───────────────────────────────────────────────────────────
{
  const md = "\\*不是斜体\\* 与 \\# 不是标题 与 \\[不是链接\\]";
  const tree = renderNumbered(md, HANDLERS);
  const text = textOf(tree);
  check("转义：显示被转义字符、反斜杠不外漏", text.includes("*不是斜体*") && !text.includes("\\"), JSON.stringify(text));
  check("转义：不产生 em", findAll(tree, (n) => localName(n) === "em").length === 0);
  checkOffsets("转义", md, tree);
}

// ── 5. 自动链接 / 裸 URL ────────────────────────────────────────────────────
{
  const md = "见 <https://example.com> 与裸链接 https://example.com/a?b=1。还有 (https://x.test/p)";
  const tree = renderNumbered(md, HANDLERS);
  const links = findAll(tree, (n) => localName(n) === "a" && hasClass(n, "dsh-obs-autolink"));
  const hrefs = links.map((a) => a.props.href);
  const text = textOf(tree);
  check("自动链接：<https://…> → a", text.includes("https://example.com") && hrefs.includes("https://example.com"), JSON.stringify(hrefs));
  check("裸链接：a href 去掉尾部句号", hrefs.includes("https://example.com/a?b=1"), JSON.stringify(hrefs));
  check("裸链接：句号仍作为普通文本", text.includes("a?b=1。"), JSON.stringify(text));
  check("裸链接：单独成对的括号不算进 URL", hrefs.includes("https://x.test/p"), JSON.stringify(hrefs));
  checkOffsets("自动链接", md, tree);
}

// ── 6. 表格单元格与引用行内同样生效 ─────────────────────────────────────────
{
  const md = "| 列 | 值 |\n| --- | --- |\n| ==高亮== | https://example.com |";
  const tree = renderNumbered(md, HANDLERS);
  check("表格：单元格内 ==高亮== → mark", findAll(tree, (n) => localName(n) === "mark").length === 1);
  check("表格：单元格内裸 URL → a", findAll(tree, (n) => localName(n) === "a").length === 1);
  checkOffsets("表格", md, tree);
}

// ── 汇总 ───────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.cond);
if (failed.length > 0) {
  console.error(`\n${failed.length} 条行内语法断言失败：${failed.map((c) => c.name).join(" | ")}`);
  process.exit(1);
}
console.log("\nP2 行内语法（第一批）断言全部通过 ✔");
