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

  return { layoutGraph, localSubgraph, adjacency, rng };
})();
