/**
 * 思维导图（B1）：把 Markdown 笔记的「标题 + 列表」解析成层级树，并做横向树布局。
 *
 * 纯函数、零 React 依赖：client 半用它渲染 SVG，测试直接断言树/布局/分支区间。
 * 只收标题（#～######）与列表项（- * + 1.）；代码围栏内的内容不算；段落忽略。
 *
 * 设计取舍：
 * - 节点行号（line / endLine，1 起）是「点节点跳到源码行」与「针对分支提问」的锚；
 *   分支区间 = 该节点行到其子树最大行，因此引用分支时能把整段内容一起带进对话。
 * - 布局用横向树：x 由深度决定，y 由叶子顺序决定（父节点居中于子节点），
 *   节点矩形固定高度、宽度按列宽；长文本截断显示（完整文本在 title）。
 */
const mindMapModule = (() => {
  /** 节点上限：超大笔记只画前 N 个，避免一次性渲染几万个矩形。 */
  const MAX_NODES = 400;
  /** 节点显示文本上限（超出截断，完整文本放 title 属性）。 */
  const MAX_LABEL = 80;

  /** 缩进折算成列数：tab 按 4 空格（与 markdown.js 的列表层级口径一致）。 */
  function indentCols(s) {
    let n = 0;
    for (let k = 0; k < s.length; k += 1) n += s[k] === "\t" ? 4 : 1;
    return n;
  }

  /** 行内标记剥掉后作为节点文本：`**粗**`、`[[A|别名]]`、`==高亮==` 等只留可读文字。 */
  function stripInlineMarkers(s) {
    let out = String(s ?? "");
    out = out.replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, "$1");
    out = out.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, target, alias) => (alias ? alias : target));
    out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    out = out.replace(/`([^`]*)`/g, "$1");
    out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
    out = out.replace(/__([^_]+)__/g, "$1");
    out = out.replace(/~~([^~]+)~~/g, "$1");
    out = out.replace(/==([^=]+)==/g, "$1");
    out = out.replace(/\s*\^[A-Za-z0-9-]+\s*$/, "");
    return out.trim();
  }

  /** 节点显示文本：剥标记 + 截断。 */
  function nodeLabel(s) {
    const text = stripInlineMarkers(s);
    return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
  }

  /**
   * 解析笔记为树。
   * @param markdown - 笔记源码（正文，frontmatter 已由 host 剥离）。
   * @param options - `title` 作根节点文本（通常是笔记文件名）；`maxNodes` 覆盖节点上限。
   * @returns 根节点 `{ id, kind: "root", text, line: 0, endLine, children }`。
   */
  function buildTree(markdown, options = {}) {
    const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
    const limit = Number.isInteger(options.maxNodes) && options.maxNodes > 0 ? options.maxNodes : MAX_NODES;
    const root = {
      id: "n0",
      kind: "root",
      text: nodeLabel(options.title ?? "笔记"),
      line: 0,
      endLine: lines.length,
      children: [],
    };
    let seq = 1;
    let headingStack = [];
    let itemStack = [];
    let inFence = false;
    let fenceChar = "";
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const lineNo = i + 1;
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
      if (fence) {
        if (!inFence) {
          inFence = true;
          fenceChar = fence[1][0];
        } else if (raw.trim().startsWith(fenceChar)) {
          inFence = false;
        }
        continue;
      }
      if (inFence) continue;
      if (seq >= limit) break;

      const heading = /^(#{1,6})[ \t]+(.*)$/.exec(raw);
      if (heading) {
        const level = heading[1].length;
        const text = nodeLabel(heading[2].replace(/\s+#+\s*$/, ""));
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
        itemStack = [];
        const parent = headingStack.length > 0 ? headingStack[headingStack.length - 1].node : root;
        const node = { id: `n${seq++}`, kind: "heading", level, text, line: lineNo, endLine: lineNo, children: [] };
        parent.children.push(node);
        headingStack.push({ node, level });
        continue;
      }

      const item = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+([\s\S]*)$/.exec(raw);
      if (item) {
        const indent = indentCols(item[1]);
        while (itemStack.length > 0 && itemStack[itemStack.length - 1].indent >= indent) itemStack.pop();
        const body = item[3].replace(/^\[[ xX]\][ \t]+/, "");
        const text = nodeLabel(body);
        const parent = itemStack.length > 0
          ? itemStack[itemStack.length - 1].node
          : headingStack.length > 0
            ? headingStack[headingStack.length - 1].node
            : root;
        if (text === "") continue;
        const node = { id: `n${seq++}`, kind: "item", level: 0, text, line: lineNo, endLine: lineNo, children: [] };
        parent.children.push(node);
        itemStack.push({ node, indent });
        continue;
      }

      // 空行结束当前列表；普通段落不是节点，但不清标题作用域。
      if (raw.trim() === "") itemStack = [];
    }

    const computeEnd = (node) => {
      let end = node.line;
      for (const child of node.children) end = Math.max(end, computeEnd(child));
      node.endLine = end;
      return end;
    };
    computeEnd(root);
    root.endLine = lines.length;
    return root;
  }

  /**
   * 横向树布局。
   * @param tree - {@link buildTree} 的根节点。
   * @param options - rowH/colW/padX/padY/nodeH 覆盖默认尺寸（测试可传小值）。
   * @returns `{ nodes, edges, width, height, byId }`；nodes 按 y/x 排序，byId 为 id → 节点。
   */
  function layout(tree, options = {}) {
    const rowH = options.rowH ?? 44;
    const colW = options.colW ?? 248;
    const padX = options.padX ?? 36;
    const padY = options.padY ?? 36;
    const nodeH = options.nodeH ?? 30;
    const nodes = [];
    const edges = [];
    let leafCursor = 0;

    const walk = (node, depth) => {
      let centerY;
      if (node.children.length === 0) {
        centerY = leafCursor * rowH;
        leafCursor += 1;
      } else {
        const centers = node.children.map((child) => walk(child, depth + 1));
        centerY = (centers[0] + centers[centers.length - 1]) / 2;
      }
      nodes.push({
        id: node.id,
        kind: node.kind,
        text: node.text,
        line: node.line,
        endLine: node.endLine,
        depth,
        x: padX + depth * colW,
        y: padY + centerY,
        w: colW - 40,
        h: nodeH,
      });
      for (const child of node.children) edges.push({ from: node.id, to: child.id });
      return centerY;
    };
    walk(tree, 0);

    const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), 0);
    const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
    return {
      nodes: nodes.sort((a, b) => (a.y - b.y) || (a.x - b.x)),
      edges,
      byId,
      width: padX * 2 + maxDepth * colW + (colW - 40),
      height: Math.max(1, leafCursor) * rowH + padY * 2,
    };
  }

  /**
   * 把「某节点 + 全部后代」映射回源码区间，供「针对分支提问」使用。
   * @param markdown - 笔记源码。
   * @param node - 树节点（需要 line/endLine，1 起）。
   * @returns `{ start, end, text, startLine, endLine }`；start/end 是整篇源码的字符偏移。
   */
  function branchSpan(markdown, node) {
    const norm = String(markdown ?? "").replace(/\r\n/g, "\n");
    const lines = norm.split("\n");
    const startLine = Math.max(1, node && node.line ? node.line : 1);
    const endLine = Math.max(startLine, node && node.endLine ? node.endLine : startLine);
    let start = 0;
    for (let i = 1; i < startLine && i <= lines.length; i += 1) start += lines[i - 1].length + 1;
    let end = start;
    const lastLine = Math.min(endLine, lines.length);
    for (let i = startLine; i <= lastLine; i += 1) {
      end += lines[i - 1].length;
      if (i < lastLine) end += 1;
    }
    return { start, end, text: norm.slice(start, end), startLine, endLine };
  }

  return { buildTree, layout, branchSpan, nodeLabel, stripInlineMarkers, indentCols, MAX_NODES, MAX_LABEL };
})();
