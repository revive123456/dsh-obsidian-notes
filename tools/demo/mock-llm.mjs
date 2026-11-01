#!/usr/bin/env node
/**
 * Zero-dependency mock of an OpenAI-compatible Chat Completions endpoint, for
 * the demo GIF only.
 *
 * Why: the README GIF should show the whole loop — select a passage in a note,
 * ask about it, see the composed prompt land in the DSH composer, send it, and
 * get a reply back. That last step needs a model route. The demo must never
 * touch the real ~/.dsh credentials or call a paid API, so tools/demo/setup.sh
 * points the isolated DSH profile at this local server instead.
 *
 * Speaks just enough of the protocol:
 *   GET  /v1/models              → model list
 *   POST /v1/chat/completions    → streaming SSE (stream:true) or plain JSON
 *
 * Usage: node tools/demo/mock-llm.mjs [--port 5613]
 */
import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.MOCK_LLM_PORT || 5613);
const HOST = "127.0.0.1";

const ANSWER =
  "Every source line is rendered as its own row, and the gutter on the left carries the line number. " +
  "That is why a selection can still point at an exact line when it is handed to the chat: the path, " +
  "the line range and the quoted text travel together with your question.";

function flatten(content) {
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .map((part) => (typeof part === "string" ? part : part?.text ?? part?.content ?? ""))
    .join("\n");
}

/** The reply the gallery question should produce; other prompts get a short honest line. */
function replyFor(messages) {
  const system = messages.find((m) => m?.role === "system");
  if (/Create a concise title/i.test(flatten(system?.content))) return "Line numbers in preview";
  const userText = messages.filter((m) => m?.role === "user").map((m) => flatten(m.content)).join("\n");
  if (/line numbers?|行号|line number/i.test(userText)) return ANSWER;
  if (/read a note/i.test(userText)) return "Sure — open the note you are reading and ask me about any line; I will explain it with the passage you select.";
  return "This is the isolated demo route. The real plugin sends your question and the selected passage to whichever DSH model you configured.";
}

function chunk(id, model, delta, finish = null) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

async function readBody(req, cap = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > cap) throw new Error("body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  if (process.env.MOCK_DEBUG === "1") {
    const file = process.env.MOCK_LOG_FILE || "/tmp/dsh-storefront-demo/mock-requests.jsonl";
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), req: req.method, path: url.pathname, auth: Boolean(req.headers.authorization) })}\n`);
  }
  if (req.method === "GET" && url.pathname === "/v1/models") {
    return json(200, {
      object: "list",
      data: [{ id: "demo-chat", object: "model", created: 0, owned_by: "dsh-demo" }],
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return json(400, { error: { message: `bad request body: ${err.message}`, type: "invalid_request_error" } });
    }
    if (process.env.MOCK_DEBUG === "1") {
      const file = process.env.MOCK_LOG_FILE || "/tmp/dsh-storefront-demo/mock-requests.jsonl";
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), body })}\n`);
    }
    const model = body.model || "demo-chat";
    const id = `chatcmpl-demo-${Date.now()}`;
    const answer = replyFor(Array.isArray(body.messages) ? body.messages : []);

    if (body.stream === true) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(chunk(id, model, { role: "assistant", content: "" }));
      // Type the answer in small pieces so the GIF shows a live reply.
      const pieces = answer.match(/\S+\s*/g) ?? [answer];
      for (const piece of pieces) {
        await new Promise((r) => setTimeout(r, 28));
        if (res.destroyed) return;
        res.write(chunk(id, model, { content: piece }));
      }
      res.write(chunk(id, model, {}, "stop"));
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    return json(200, {
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }

  json(404, { error: { message: "not found", type: "invalid_request_error" } });
});

server.listen(PORT, HOST, () => {
  console.log(`mock-llm: OpenAI-compatible demo route on http://${HOST}:${PORT}/v1`);
});
