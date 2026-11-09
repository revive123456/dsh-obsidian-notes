/**
 * 关系图谱（Obsidian Graph view 的产品化版本，纯函数、零依赖）：
 * - `layoutGraph(nodes, edges, opts)`：确定性力导向布局（同一 seed 结果可复现，
 *   便于截图/GIF 与测试）；
 * - `localSubgraph(graph, noteId, depth)`：以某篇笔记为中心截 N 跳子图（Obsidian 的 local graph）。
 *
 * 节点/连线由 host 侧 `/obsidian/graph` 计算（全库 .md + [[双链]] + 标签），
 * 这里只负责「怎么摆」和「怎么截」。布局在 >maxNodes 时按度数保留最重要的节点，
 * 避免一次渲染上千个圆点卡住 UI。
 */
const graphModule = (() => {
  /** 可复现的伪随机数（mulberry32）：同一 seed 得到同一布局。 */
  function rng(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 邻接表（双向），用于度数、局部子图与渲染高亮。 */
  function adjacency(nodes, edges) {
    const map = new Map(nodes.map((node) => [node.id, []]));
    for (const edge of edges) {
      if (!map.has(edge.source) || !map.has(edge.target)) continue;
      map.get(edge.source).push(edge.target);
      map.get(edge.target).push(edge.source);
    }
    return map;
  }

  /**
   * 力导向布局。
   * @param nodes - `[{ id, kind, label, path? }]`。
   * @param edges - `[{ source, target }]`（id 对）。
   * @param options - width/height/iterations/maxNodes/seed。
   * @returns `{ nodes: [{id,x,y,degree}], width, height, truncated }`。
   */
  function layoutGraph(nodes, edges, options = {}) {
    const width = options.width ?? 1400;
    const height = options.height ?? 960;
    const iterations = options.iterations ?? 220;
    const maxNodes = options.maxNodes ?? 500;
    const seed = options.seed ?? 1;
    const padding = options.padding ?? 60;
    const rand = rng(seed);

    const adj = adjacency(nodes, edges);
    let list = nodes;
    let links = edges;
    let truncated = false;
    if (nodes.length > maxNodes) {
      truncated = true;
      list = [...nodes]
        .sort((a, b) => (adj.get(b.id).length - adj.get(a.id).length) || String(a.id).localeCompare(String(b.id)))
        .slice(0, maxNodes);
    }
    const index = new Map(list.map((node, i) => [node.id, i]));
    links = links.filter((edge) => index.has(edge.source) && index.has(edge.target));

    const n = list.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const vx = new Float64Array(n);
    const vy = new Float64Array(n);
    const cx = width / 2;
    const cy = height / 2;
    // 初始点：圆周分布 + 抖动，避免完全对称的力平衡（那样图形会挤成一团）
    for (let i = 0; i < n; i += 1) {
      const angle = (i / Math.max(1, n)) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.36 * (0.55 + rand() * 0.45);
      xs[i] = cx + Math.cos(angle) * radius;
      ys[i] = cy + Math.sin(angle) * radius;
    }
    const linkIndex = links.map((edge) => ({ a: index.get(edge.source), b: index.get(edge.target) }));
    const degree = new Int32Array(n);
    for (const link of linkIndex) {
      degree[link.a] += 1;
      degree[link.b] += 1;
    }

    const repulse = 26000;
    const minDist = 26;
    const springLength = 120;
    const springK = 0.012;
    const gravity = 0.0035;
    for (let step = 0; step < iterations; step += 1) {
      // 斥力（O(n²)，n 已被 maxNodes 限制）
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          let dx = xs[i] - xs[j];
          let dy = ys[i] - ys[j];
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 0.01) {
            dx = (rand() - 0.5) * 0.6;
            dy = (rand() - 0.5) * 0.6;
            dist2 = dx * dx + dy * dy;
          }
          if (dist2 < minDist * minDist) dist2 = minDist * minDist;
          const force = repulse / dist2;
          const dist = Math.sqrt(dist2);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          vx[i] += fx;
          vy[i] += fy;
          vx[j] -= fx;
          vy[j] -= fy;
        }
      }
      // 弹簧（边）
      for (const link of linkIndex) {
        const dx = xs[link.b] - xs[link.a];
        const dy = ys[link.b] - ys[link.a];
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (dist - springLength) * springK;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        vx[link.a] += fx;
        vy[link.a] += fy;
        vx[link.b] -= fx;
        vy[link.b] -= fy;
      }
      // 向心力 + 阻尼积分
      for (let i = 0; i < n; i += 1) {
        vx[i] += (cx - xs[i]) * gravity;
        vy[i] += (cy - ys[i]) * gravity;
        vx[i] *= 0.82;
        vy[i] *= 0.82;
        const maxStep = 28;
        if (vx[i] > maxStep) vx[i] = maxStep;
        if (vx[i] < -maxStep) vx[i] = -maxStep;
        if (vy[i] > maxStep) vy[i] = maxStep;
        if (vy[i] < -maxStep) vy[i] = -maxStep;
        xs[i] += vx[i];
        ys[i] += vy[i];
      }
    }

    // 归一化到画布（保留 padding），图形太小时水平居中撑开
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i += 1) {
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (ys[i] < minY) minY = ys[i];
      if (ys[i] > maxY) maxY = ys[i];
    }
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const usableW = width - padding * 2;
    const usableH = height - padding * 2;
    const scale = Math.min(usableW / spanX, usableH / spanY, 1.8);
    const offsetX = padding + (usableW - spanX * scale) / 2;
    const offsetY = padding + (usableH - spanY * scale) / 2;
    const placed = list.map((node, i) => ({
      ...node,
      x: offsetX + (xs[i] - minX) * scale,
      y: offsetY + (ys[i] - minY) * scale,
      degree: degree[i],
    }));
    return { nodes: placed, width, height, truncated };
  }

  /**
   * 以某节点为中心截 N 跳子图（Obsidian 的 local graph）。
   * @param graph - `{ nodes, edges }`（host 返回）。
   * @param noteId - 中心节点 id（笔记节点是 `note:<rel>`）。
   * @param depth - 跳数（默认 2）。
   * @returns `{ nodes, edges, found }`。
   */
  function localSubgraph(graph, noteId, depth = 2) {
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    if (!byId.has(noteId)) return { nodes: [], edges: [], found: false };
    const adj = adjacency(nodes, edges);
    const seen = new Set([noteId]);
    let frontier = [noteId];
    for (let hop = 0; hop < depth; hop += 1) {
      const next = [];
      for (const id of frontier) {
        for (const other of adj.get(id) ?? []) {
          if (seen.has(other)) continue;
          seen.add(other);
          next.push(other);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    const keep = new Set([...seen].filter((id) => byId.has(id)));
    return {
      nodes: nodes.filter((node) => keep.has(node.id)),
      edges: edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
      found: true,
    };
  }


  /**
   * 「聚焦」模式的镜头：全库不裁剪，只把视口对准某篇笔记和它的一跳邻居。
   *
   * 和 localSubgraph 的分工：局部是「只留这块节点」，聚焦是「节点都在，镜头对准这块」。
   * 输入是 layoutGraph 的布局坐标与画布像素尺寸，输出直接可用的 SVG 平移/缩放。
   *
   * @param plan - `layoutGraph()` 的返回值（nodes 带 x/y）。
   * @param edges - 与 `plan.nodes` 对应的连线（`[{ source, target }]`）。
   * @param focusId - 焦点节点 id（笔记节点是 `note:<rel>`）。
   * @param viewport - `{ width, height }` 画布像素尺寸。
   * @param options - `{ padding, maxScale }`：padding 为布局坐标里的留白（默认 80），
   *   maxScale 限制推近倍数（默认 1.6，邻居很少时不至于糊脸）。
   * @returns `{ x, y, s }`；焦点不在布局里时返回 null（调用方退回整图适配）。
   */
  function focusViewport(plan, edges, focusId, viewport, options = {}) {
    const nodes = plan && Array.isArray(plan.nodes) ? plan.nodes : [];
    const center = nodes.find((node) => node.id === focusId);
    if (center === undefined) return null;
    const near = new Set([focusId]);
    for (const edge of edges ?? []) {
      if (edge.source === focusId) near.add(edge.target);
      else if (edge.target === focusId) near.add(edge.source);
    }
    let minX = center.x;
    let maxX = center.x;
    let minY = center.y;
    let maxY = center.y;
    for (const node of nodes) {
      if (!near.has(node.id)) continue;
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    }
    const padding = options.padding ?? 80;
    const maxScale = options.maxScale ?? 1.6;
    const width = viewport && Number.isFinite(viewport.width) ? viewport.width : 900;
    const height = viewport && Number.isFinite(viewport.height) ? viewport.height : 560;
    // 单点邻居（焦点没有连线）时包围盒是 0×0，+padding 后仍可算；max(1) 只为除零兜底
    const boxW = Math.max(1, maxX - minX + padding * 2);
    const boxH = Math.max(1, maxY - minY + padding * 2);
    const raw = Math.min((width - 30) / boxW, (height - 30) / boxH, maxScale);
    const scale = Math.max(0.18, raw);
    return {
      x: width / 2 - ((minX + maxX) / 2) * scale,
      y: height / 2 - ((minY + maxY) / 2) * scale,
      s: scale,
    };
  }


  /** POSIX 风格拼接 + 折叠 `.`/`..`（客户端兜底构建时与 host 同一套链接解析）。 */
  function joinPosix(dir, rel) {
    const parts = dir === "" ? [] : dir.split("/");
    for (const seg of rel.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  }

  /**
   * `[[链接目标]]` → 笔记相对路径（与 host 侧 / Obsidian 语义一致：精确路径 →
   * 相对当前笔记目录 → 文件名，多个候选取层数最浅再字母序）。
   * 客户端兜底构建图谱时用；解析不到返回 null。
   */
  function resolveGraphLink(target, fromRel, byPath, byBase) {
    let raw = String(target == null ? "" : target).trim();
    if (raw === "" || /^[a-z]+:\/\//i.test(raw)) return null;
    raw = raw.replace(/\\/g, "/");
    const stripExt = (value) => value.replace(/\.md$/i, "");
    const tryPath = (value) => byPath.get(stripExt(value).replace(/^\.\//, "").toLowerCase()) ?? null;
    let hit = tryPath(raw);
    if (hit !== null) return hit;
    if (raw.includes("/") || raw.startsWith(".")) {
      const dir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
      hit = tryPath(joinPosix(dir, raw));
      if (hit !== null) return hit;
    }
    const base = stripExt(raw.split("/").pop()).toLowerCase();
    const list = byBase.get(base);
    if (list === undefined || list.length === 0) return null;
    if (list.length === 1) return list[0];
    return [...list].sort((a, b) => (a.split("/").length - b.split("/").length) || a.localeCompare(b))[0];
  }

  /**
   * 客户端兜底：用「笔记列表 + 每篇的 links/tags」构建与 host 相同形状的图。
   * 用途：插件升级后 host 还是旧版（没有 /obsidian/graph 路由）时，前端仍能
   * 通过旧接口自建图谱 —— 用户无感知、不用重启 DSH。
   * @param notes - `[{ path, links, tags }]`（path 为 vault 相对路径）。
   * @returns `{ nodes, edges, stats }`。
   */
  function buildGraphFromNotes(notes, options = {}) {
    const maxNotes = options.maxNotes ?? 1200;
    const maxEdges = options.maxEdges ?? 12000;
    const maxTags = options.maxTags ?? 800;
    const list = [...notes].slice(0, maxNotes);
    const byPath = new Map();
    const byBase = new Map();
    for (const note of list) {
      const noExt = note.path.replace(/\.md$/i, "");
      byPath.set(noExt.toLowerCase(), note.path);
      const base = (noExt.split("/").pop() || noExt).toLowerCase();
      const bucket = byBase.get(base);
      if (bucket === undefined) byBase.set(base, [note.path]);
      else bucket.push(note.path);
    }
    const nodes = new Map();
    for (const note of list) {
      nodes.set(`note:${note.path}`, {
        id: `note:${note.path}`,
        kind: "note",
        label: (note.path.split("/").pop() || note.path).replace(/\.md$/i, ""),
        path: note.path,
      });
    }
    const edges = [];
    const seen = new Set();
    const addEdge = (source, target) => {
      if (edges.length >= maxEdges) return;
      const key = `${source}\u0000${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ source, target });
    };
    const tagIds = new Map();
    let unresolved = 0;
    for (const note of list) {
      const self = `note:${note.path}`;
      for (const link of note.links ?? []) {
        const target = resolveGraphLink(link, note.path, byPath, byBase);
        if (target === null) {
          unresolved += 1;
          continue;
        }
        if (target !== note.path) addEdge(self, `note:${target}`);
      }
      for (const tag of note.tags ?? []) {
        const key = String(tag).toLowerCase();
        let tagId = tagIds.get(key);
        if (tagId === undefined) {
          if (tagIds.size >= maxTags) continue;
          tagId = `tag:${key}`;
          tagIds.set(key, tagId);
          nodes.set(tagId, { id: tagId, kind: "tag", label: `#${tag}` });
        }
        addEdge(self, tagId);
      }
    }
    return {
      nodes: [...nodes.values()],
      edges,
      stats: {
        notes: list.length,
        tags: tagIds.size,
        edges: edges.length,
        unresolved,
        truncated: notes.length > maxNotes,
        source: "client",
      },
    };
  }


  /**
   * 从笔记内容 + frontmatter 提取标签（客户端兜底构建图谱时用；与 host 解析同语义）。
   * @param content - 笔记正文。
   * @param frontmatter - `{ tags: "..." }` 形态的 frontmatter 映射。
   * @returns 标签名数组（不含 `#`、去重）。
   */
  function extractTags(content, frontmatter) {
    const tags = new Set();
    const fm = frontmatter && frontmatter.tags;
    if (typeof fm === "string" && fm.trim() !== "") {
      for (const token of fm.replace(/^\[|\]$/g, "").split(/[,\s]+/)) {
        const tag = token.replace(/^#/, "").replace(/^["']|["']$/g, "").trim();
        if (tag !== "" && /^[\p{L}\p{N}_/-]{1,64}$/u.test(tag)) tags.add(tag);
      }
    }
    const body = String(content ?? "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/~~~[\s\S]*?~~~/g, " ")
      .replace(/`[^`\n]*`/g, " ");
    const re = /(^|[\s(（\[【,，;；、>|])#([\p{L}\p{N}_/-]{1,64})/gu;
    for (const match of body.matchAll(re)) {
      const tag = match[2].replace(/\/+$/, "");
      if (tag !== "" && !/^\d+$/.test(tag)) tags.add(tag);
    }
    return [...tags];
  }

  return { layoutGraph, localSubgraph, focusViewport, adjacency, rng, resolveGraphLink, buildGraphFromNotes, extractTags };
})();
