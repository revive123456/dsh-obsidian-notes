/**
 * 关系图谱 host 路由测试：直接用 createHandler 拉起本地 http server，
 * 覆盖「全库 .md + [[双链]] + 标签 + 未解析链接 + mtime 增量缓存」。
 */
import { createServer } from "node:http";
import { mkdtemp, mkdir, realpath, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "../src/index.js";

const base = await realpath(await mkdtemp(join(tmpdir(), "dsh-obs-graph-")));
process.env.DSH_HOME = join(base, "dshhome");
process.env.DSH_WORKSPACE = join(base, "ws");
const vault = join(process.env.DSH_WORKSPACE, "obsidian_vault");
await mkdir(join(vault, "sub"), { recursive: true });

await writeFile(join(vault, "a.md"), "---\ntags: [alpha]\n---\n# A\n\n[[B]] 与 [[missing]] #beta\n", "utf8");
await writeFile(join(vault, "sub", "b.md"), "# B\n\n回到 [[a]]\n", "utf8");
await writeFile(join(vault, "sub", "c.md"), "# C\n\n没有任何链接\n", "utf8");
await writeFile(join(vault, "not-a-note.txt"), "# not a note", "utf8");

const handler = createHandler();
const server = createServer((req, res) => void handler(req, res));
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

async function graph() {
  const res = await fetch(`${origin}/obsidian/graph`, { headers: { "x-dsh-obsidian": "1" } });
  return { status: res.status, json: await res.json() };
}

const failures = [];
function check(name, cond, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures.push(name);
}

const first = await graph();
check("GET /obsidian/graph 200", first.status === 200, String(first.status));
const nodeIds = new Set(first.json.nodes.map((n) => n.id));
const noteNodes = first.json.nodes.filter((n) => n.kind === "note");
const tagNodes = first.json.nodes.filter((n) => n.kind === "tag");
check("节点：3 篇笔记（忽略非 .md）", noteNodes.length === 3 && nodeIds.has("note:a.md") && nodeIds.has("note:sub/b.md") && nodeIds.has("note:sub/c.md"),
  [...nodeIds].join(","));
check("节点：标签 alpha(frontmatter) + beta(正文)", tagNodes.length === 2 && nodeIds.has("tag:alpha") && nodeIds.has("tag:beta"),
  tagNodes.map((n) => n.id).join(","));
const edgeKeys = new Set(first.json.edges.map((e) => `${e.source}->${e.target}`));
check("连线：a→B 解析到 sub/b.md", edgeKeys.has("note:a.md->note:sub/b.md"), [...edgeKeys].join(" | "));
check("连线：b.md 的 [[a]] 反链", edgeKeys.has("note:sub/b.md->note:a.md"));
check("连线：a→#beta、a→#alpha 标签边", edgeKeys.has("note:a.md->tag:beta") && edgeKeys.has("note:a.md->tag:alpha"));
check("未解析链接计入 unresolved、不产生幽灵节点", first.json.stats.unresolved === 1 && !nodeIds.has("note:missing.md"),
  `unresolved=${first.json.stats.unresolved}`);
check("stats 口径", first.json.stats.notes === 3 && first.json.stats.tags === 2, JSON.stringify(first.json.stats));

// 缓存：同一 vault 第二次请求不重新构建（generatedAt 相同）
const second = await graph();
check("缓存命中（generatedAt 不变）", second.json.generatedAt === first.json.generatedAt);

// 修改一篇笔记（mtime 变化）→ 重新解析并反映新标签/新链接
await writeFile(join(vault, "a.md"), "---\ntags: [alpha]\n---\n# A\n\n[[B]] [[c]] #gamma\n", "utf8");
const future = new Date(Date.now() + 5000);
await utimes(join(vault, "a.md"), future, future);
const third = await graph();
const nodeIds3 = new Set(third.json.nodes.map((n) => n.id));
const edgeKeys3 = new Set(third.json.edges.map((e) => `${e.source}->${e.target}`));
check("增量刷新：新标签 gamma 出现、旧 beta 消失", nodeIds3.has("tag:gamma") && !nodeIds3.has("tag:beta"),
  [...nodeIds3].filter((id) => id.startsWith("tag:")).join(","));
check("增量刷新：新链接 a→c 出现", edgeKeys3.has("note:a.md->note:sub/c.md"));
check("增量刷新：generatedAt 变化", third.json.generatedAt !== first.json.generatedAt);

server.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} 条图谱 host 断言失败：${failures.join(" | ")}`);
  process.exit(1);
}
console.log("\n关系图谱 host 路由断言全部通过 ✔");
