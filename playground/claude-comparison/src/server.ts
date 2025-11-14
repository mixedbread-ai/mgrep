#!/usr/bin/env node

import { createServer, IncomingMessage, ServerResponse } from "http";
import { parse as parseUrl } from "url";
import { runPlayground, type PlaygroundConfig } from "./runner";

type SSEClient = {
  id: number;
  res: ServerResponse;
};

const PORT = Number.parseInt(process.env.PLAYGROUND_PORT ?? "4311", 10);
const PRELOADED_STORE = "5f695f94-32a6-423f-ac6a-487aa56982b2";
const DEFAULT_STORE = process.env.MXBAI_STORE || PRELOADED_STORE;
const DEFAULT_TOP_K = 5;
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest";
const DEFAULT_CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const DEFAULT_CONTEXT_CHAR_LIMIT = 4000;

const DATASETS = [
  { id: PRELOADED_STORE, label: "Mixedbread CLI Repo (preloaded demo)" },
  { id: "mgrep-playground", label: "mgrep-playground (run mgrep sync first)" },
  { id: "facebook/react", label: "facebook/react (sync required)" },
  { id: "cognition-ai/mgrep", label: "cognition-ai/mgrep (sync required)" },
  { id: "vercel/next.js", label: "vercel/next.js (sync required)" },
];

const PROMPT_SUGGESTIONS: Record<string, string[]> = {
  [PRELOADED_STORE]: [
    "What commands does mgrep expose for syncing repositories?",
    "Explain how the mgrep watcher batches file changes.",
    "Summarize the Mixedbread authentication flow implemented in mgrep.",
  ],
  "mgrep-playground": [
    "Outline what mgrep sync uploads to Mixedbread.",
    "How do you rotate credentials for the mgrep CLI?",
    "Explain how the mgrep watcher filters ignored files.",
  ],
  "facebook/react": [
    "How does React's reconciliation algorithm efficiently update the DOM?",
    "Explain how hooks manage component state lifecycles.",
    "Summarize the purpose of the Fiber architecture in React.",
  ],
  "cognition-ai/mgrep": [
    "Outline the steps mgrep uses to sync a repository into Mixedbread.",
    "How does mgrep avoid uploading ignored files during watch mode?",
    "What environment variables does mgrep honor for authentication?",
  ],
  "vercel/next.js": [
    "How does Next.js handle incremental static regeneration?",
    "Explain the difference between the app and pages routers.",
    "How do you configure Next.js middleware for edge functions?",
  ],
};

const clients = new Map<number, SSEClient>();
let nextClientId = 1;
let activeRun: Promise<void> | null = null;

const server = createServer(async (req, res) => {
  const url = parseUrl(req.url ?? "/", true);
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "GET" && url.pathname === "/") {
    serveHomepage(res);
    return;
  }

  if (method === "GET" && url.pathname === "/events") {
    handleSSE(req, res);
    return;
  }

  if (method === "POST" && url.pathname === "/run") {
    if (activeRun) {
      respondJson(res, 409, { error: "A run is already in progress." });
      return;
    }
    try {
      const body = await readJson(req);
      const config = buildConfigFromBody(body);
      if (!config.prompt) {
        respondJson(res, 400, { error: "Prompt is required." });
        return;
      }
      broadcast({ type: "run_start", timestamp: Date.now(), prompt: config.prompt });
      activeRun = runPlayground(config, {
        onContextReady: (context) => {
          broadcast({
            type: "context",
            timestamp: Date.now(),
            available: context.available,
            chunkCount: context.chunks.length,
            warning: context.warning,
          });
        },
        onLaneStart: (lane) => {
          broadcast({
            type: "lane_start",
            timestamp: Date.now(),
            lane: lane.label,
            kind: lane.kind,
          });
        },
        onEvent: (event) => {
          broadcast({
            type: "lane_event",
            timestamp: Date.now(),
            event,
          });
        },
        onLaneComplete: (summary) => {
          broadcast({
            type: "lane_complete",
            timestamp: Date.now(),
            lane: summary.label,
            kind: summary.kind,
            durationMs: summary.durationMs,
            exitCode: summary.exitCode,
            signal: summary.signal,
          });
        },
      })
        .then((summary) => {
          broadcast({
            type: "run_summary",
            timestamp: Date.now(),
            summary,
          });
        })
        .catch((err) => {
          const message =
            err instanceof Error ? err.message : "Claude playground run failed.";
          broadcast({
            type: "run_error",
            timestamp: Date.now(),
            error: message,
          });
        })
        .finally(() => {
          activeRun = null;
        });

      respondJson(res, 202, { status: "accepted" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid request body.";
      respondJson(res, 400, { error: message });
    }
    return;
  }

  respondJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Claude vs mgrep playground UI listening on http://localhost:${PORT}`);
  console.log("Open the URL above to launch a comparison run.");
  if (!process.env.MXBAI_API_KEY) {
    console.warn(
      "⚠️ MXBAI_API_KEY is not set. The mgrep lane will run without context until you export it.",
    );
  }
});

function serveHomepage(res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(getHtml());
}

function handleSSE(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write("\n");

  const id = nextClientId++;
  clients.set(id, { id, res });

  req.on("close", () => {
    clients.delete(id);
  });
}

function broadcast(payload: Record<string, unknown>): void {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients.values()) {
    client.res.write(data);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Expected JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function buildConfigFromBody(body: Record<string, unknown>): PlaygroundConfig {
  const prompt =
    typeof body.prompt === "string" ? body.prompt.trim() : "";

  const store =
    typeof body.store === "string" && body.store.trim().length > 0
      ? body.store.trim()
      : DEFAULT_STORE;

  const topK =
    typeof body.topK === "number" && Number.isFinite(body.topK) && body.topK > 0
      ? Math.floor(body.topK)
      : DEFAULT_TOP_K;

  const model =
    typeof body.model === "string" && body.model.trim().length > 0
      ? body.model.trim()
      : DEFAULT_MODEL;

  const claudeBin =
    typeof body.claudeBin === "string" && body.claudeBin.trim().length > 0
      ? body.claudeBin.trim()
      : DEFAULT_CLAUDE_BIN;

  const maxContextChars =
    typeof body.maxContextChars === "number" &&
    Number.isFinite(body.maxContextChars) &&
    body.maxContextChars > 0
      ? Math.floor(body.maxContextChars)
      : DEFAULT_CONTEXT_CHAR_LIMIT;

  return {
    prompt,
    store,
    topK,
    model,
    claudeBin,
    maxContextChars,
  };
}

function respondJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
}

function getHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Claude Code + mgrep Playground | Mixedbread</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    :root {
      color-scheme: dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    body {
      background: #000;
      color: #fff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 20px 40px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
      font-weight: 600;
      color: #fff;
    }
    .hero {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
      transition: all 0.3s ease;
    }
    .hero.minimized {
      flex: 0;
      padding: 40px 20px 20px;
    }
    h1 {
      font-size: 56px;
      font-weight: 700;
      margin-bottom: 16px;
      letter-spacing: -0.03em;
    }
    .subtitle {
      font-size: 18px;
      color: rgba(255,255,255,0.6);
      margin-bottom: 12px;
      text-decoration: underline;
      text-decoration-color: rgba(255,255,255,0.3);
    }
    .vs-line {
      font-size: 16px;
      color: rgba(255,255,255,0.5);
      margin-bottom: 40px;
    }
    .input-container {
      width: 100%;
      max-width: 720px;
      margin: 0 auto;
    }
    .input-wrapper {
      position: relative;
      margin-bottom: 16px;
    }
    .prompt-input {
      width: 100%;
      padding: 18px 24px;
      font-size: 16px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      color: #fff;
      outline: none;
      transition: all 0.2s ease;
    }
    .prompt-input:focus {
      background: rgba(255,255,255,0.06);
      border-color: #FF6B35;
      box-shadow: 0 0 0 3px rgba(255,107,53,0.15);
    }
    .prompt-input::placeholder {
      color: rgba(255,255,255,0.4);
    }
    .controls {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: center;
    }
    .store-select {
      padding: 10px 16px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      outline: none;
      cursor: pointer;
    }
    .btn-start {
      padding: 12px 32px;
      font-size: 15px;
      font-weight: 600;
      background: #FF6B35;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-start:hover:not(:disabled) {
      background: #FF7A45;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(255,107,53,0.4);
    }
    .btn-start:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .chips {
      display: flex;
      gap: 8px;
      justify-content: center;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    .chip {
      padding: 8px 16px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      font-size: 13px;
      color: rgba(255,255,255,0.7);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .chip:hover {
      background: rgba(255,107,53,0.1);
      border-color: rgba(255,107,53,0.3);
      color: #FF6B35;
    }
    .results-container {
      display: none;
      padding: 20px 40px 40px;
      gap: 20px;
      flex: 1;
    }
    .results-container.active {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .panel {
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .panel-header {
      padding: 16px 20px;
      background: rgba(255,255,255,0.02);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .panel-title {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }
    .panel-status {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 4px 10px;
      border-radius: 6px;
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.5);
    }
    .panel-status.processing {
      background: rgba(255,107,53,0.15);
      color: #FF6B35;
    }
    .panel-status.done {
      background: rgba(34,197,94,0.15);
      color: #22c55e;
    }
    .panel-status.error {
      background: rgba(239,68,68,0.15);
      color: #ef4444;
    }
    .panel-body {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
      font-family: "SF Mono", Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.7;
      color: rgba(255,255,255,0.8);
    }
    .panel-body:empty::before {
      content: "Waiting...";
      color: rgba(255,255,255,0.3);
      font-style: italic;
    }
    .log-entry {
      margin-bottom: 6px;
    }
    .log-entry.read {
      color: #60a5fa;
    }
    .log-entry.grep {
      color: #22c55e;
    }
    .log-entry.think {
      color: #fbbf24;
      font-style: italic;
    }
    .log-entry.text {
      color: rgba(255,255,255,0.85);
    }
    .log-entry.error {
      color: #ef4444;
    }
    .context-info {
      padding: 12px 20px;
      margin: 0 40px 20px;
      background: rgba(255,107,53,0.08);
      border: 1px solid rgba(255,107,53,0.2);
      border-radius: 8px;
      font-size: 13px;
      color: rgba(255,255,255,0.8);
      text-align: center;
    }
    .context-info.warn {
      background: rgba(239,68,68,0.08);
      border-color: rgba(239,68,68,0.2);
    }
    .summary {
      padding: 16px 40px;
      text-align: center;
      font-size: 13px;
      color: rgba(255,255,255,0.5);
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    @media (max-width: 1024px) {
      .results-container.active {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">Mixedbread</div>
  </header>

  <div class="hero" id="hero">
    <h1>Try <em>Claude Code + mgrep</em></h1>
    <div class="subtitle">See how mgrep semantic search enhances Claude Code</div>
    <div class="vs-line">🧠 Claude Code + mgrep vs 💭 Claude Code</div>
    
    <div class="input-container">
      <form id="playground-form">
        <div class="input-wrapper">
          <input
            id="prompt"
            class="prompt-input"
            placeholder="Ask a question or select from the suggested ones..."
            autocomplete="off"
          />
        </div>
        <div class="controls">
          <select id="store" class="store-select">
            ${DATASETS.map((dataset) => `<option value="${dataset.id}">${dataset.label}</option>`).join("")}
          </select>
          <button type="submit" class="btn-start" id="start-btn">Start</button>
        </div>
        <div class="chips" id="suggestions"></div>
        <input type="hidden" id="topK" value="${DEFAULT_TOP_K}" />
        <input type="hidden" id="model" value="${DEFAULT_MODEL}" />
        <input type="hidden" id="claudeBin" value="${DEFAULT_CLAUDE_BIN}" />
      </form>
    </div>
  </div>

  <div class="context-info" id="context" style="display: none;"></div>

  <div class="results-container" id="results">
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">🧠 Claude Code + mgrep</div>
        <div class="panel-status" id="status-context">Idle</div>
      </div>
      <div class="panel-body" id="lane-context"></div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">💭 Claude Code (no mgrep)</div>
        <div class="panel-status" id="status-baseline">Idle</div>
      </div>
      <div class="panel-body" id="lane-baseline"></div>
    </div>
  </div>

  <div class="summary" id="summary"></div>
  <script>
    const form = document.getElementById('playground-form');
    const heroEl = document.getElementById('hero');
    const resultsEl = document.getElementById('results');
    const contextEl = document.getElementById('context');
    const laneContextEl = document.getElementById('lane-context');
    const laneBaselineEl = document.getElementById('lane-baseline');
    const summaryEl = document.getElementById('summary');
    const statusContextEl = document.getElementById('status-context');
    const statusBaselineEl = document.getElementById('status-baseline');
    const storeSelect = document.getElementById('store');
    const promptInput = document.getElementById('prompt');
    const suggestionsContainer = document.getElementById('suggestions');
    const startButton = document.getElementById('start-btn');

    const laneBuffers = {
      'Claude Code + mgrep': [],
      'Claude Code (no mgrep)': [],
    };
    const laneStatusMap = {
      'Claude Code + mgrep': { text: 'Idle', class: '' },
      'Claude Code (no mgrep)': { text: 'Idle', class: '' },
    };

    const promptSuggestions = ${JSON.stringify(PROMPT_SUGGESTIONS)};

    function renderSuggestions() {
      const dataset = storeSelect.value;
      const items = promptSuggestions[dataset] || [];
      suggestionsContainer.innerHTML = items
        .map((item) => '<button type="button" class="chip" data-prompt="' + item.replace(/"/g, '&quot;') + '">' + item + '</button>')
        .join('');
    }
    renderSuggestions();

    suggestionsContainer.addEventListener('click', (event) => {
      const button = event.target.closest('[data-prompt]');
      if (button) {
        promptInput.value = button.getAttribute('data-prompt');
      }
    });

    storeSelect.addEventListener('change', () => {
      renderSuggestions();
    });

    function formatLogEntry(text, type) {
      if (type === 'read') {
        return '<span class="log-entry read">📖 Read: ' + escapeHtml(text) + '</span>';
      } else if (type === 'grep') {
        return '<span class="log-entry grep">🔍 Grep: ' + escapeHtml(text) + '</span>';
      } else if (type === 'think') {
        return '<span class="log-entry think">💭 ' + escapeHtml(text) + '</span>';
      } else if (type === 'error') {
        return '<span class="log-entry error">❌ ' + escapeHtml(text) + '</span>';
      }
      return '<span class="log-entry text">' + escapeHtml(text) + '</span>';
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderLanes() {
      const contextHtml = laneBuffers['Claude Code + mgrep'].map(entry => formatLogEntry(entry.text, entry.type)).join('\\n');
      const baselineHtml = laneBuffers['Claude Code (no mgrep)'].map(entry => formatLogEntry(entry.text, entry.type)).join('\\n');
      laneContextEl.innerHTML = contextHtml || '';
      laneBaselineEl.innerHTML = baselineHtml || '';
      laneContextEl.scrollTop = laneContextEl.scrollHeight;
      laneBaselineEl.scrollTop = laneBaselineEl.scrollHeight;
    }

    function updateLaneStatus(lane, text, className) {
      laneStatusMap[lane] = { text, class: className };
      const el = lane === 'Claude Code + mgrep' ? statusContextEl : statusBaselineEl;
      el.textContent = text;
      el.className = 'panel-status ' + className;
    }

    const eventSource = new EventSource('/events');
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'run_start':
          heroEl.classList.add('minimized');
          resultsEl.classList.add('active');
          contextEl.style.display = 'block';
          summaryEl.textContent = '';
          laneBuffers['Claude Code + mgrep'] = [];
          laneBuffers['Claude Code (no mgrep)'] = [];
          laneContextEl.innerHTML = '';
          laneBaselineEl.innerHTML = '';
          contextEl.classList.remove('warn');
          contextEl.textContent = 'Fetching context from Mixedbread...';
          updateLaneStatus('Claude Code + mgrep', 'Processing…', 'processing');
          updateLaneStatus('Claude Code (no mgrep)', 'Waiting…', '');
          break;
        case 'context':
          if (data.available) {
            contextEl.classList.remove('warn');
            contextEl.textContent = 'Context available — ' + data.chunkCount + ' chunk(s)';
            updateLaneStatus('Claude Code + mgrep', 'Processing…', 'processing');
          } else {
            contextEl.classList.add('warn');
            contextEl.textContent = 'Context unavailable' + (data.warning ? ': ' + data.warning : '');
            updateLaneStatus('Claude Code + mgrep', 'Baseline mode', '');
          }
          break;
        case 'lane_event':
          const lane = data.event.lane;
          if (data.event.type === 'text') {
            laneBuffers[lane].push({ text: data.event.text, type: 'text' });
          } else if (data.event.type === 'read') {
            laneBuffers[lane].push({ text: data.event.text, type: 'read' });
          } else if (data.event.type === 'grep') {
            laneBuffers[lane].push({ text: data.event.text, type: 'grep' });
          } else if (data.event.type === 'think') {
            laneBuffers[lane].push({ text: data.event.text, type: 'think' });
          } else if (data.event.type === 'stop') {
            laneBuffers[lane].push({ text: '\\n--- end of response ---', type: 'text' });
          } else if (data.event.type === 'stderr') {
            laneBuffers[lane].push({ text: '[stderr] ' + data.event.text, type: 'text' });
          } else if (data.event.type === 'error') {
            laneBuffers[lane].push({ text: '[error] ' + data.event.message, type: 'error' });
          }
          renderLanes();
          break;
        case 'lane_complete':
          const completeLane = data.lane;
          laneBuffers[completeLane].push({ text: '\\n--- completed in ' + data.durationMs.toFixed(0) + ' ms ---', type: 'text' });
          updateLaneStatus(completeLane, 'Done', 'done');
          renderLanes();
          break;
        case 'run_summary':
          if (data.summary && data.summary.lanes) {
            const details = data.summary.lanes
              .map((lane) => lane.label + ' · ' + lane.durationMs.toFixed(0) + ' ms')
              .join(' | ');
            summaryEl.innerHTML = '<strong>Timing:</strong> ' + details;
          }
          break;
        case 'run_error':
          heroEl.classList.add('minimized');
          resultsEl.classList.add('active');
          contextEl.style.display = 'block';
          contextEl.classList.add('warn');
          contextEl.textContent = data.error;
          summaryEl.textContent = data.error;
          updateLaneStatus('Claude Code + mgrep', 'Error', 'error');
          updateLaneStatus('Claude Code (no mgrep)', 'Error', 'error');
          break;
        default:
          break;
      }
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!promptInput.value.trim()) {
        return;
      }
      startButton.disabled = true;
      const payload = {
        prompt: promptInput.value,
        store: storeSelect.value,
        topK: Number(document.getElementById('topK').value),
        model: document.getElementById('model').value,
        claudeBin: document.getElementById('claudeBin').value,
      };
      const response = await fetch('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        heroEl.classList.add('minimized');
        resultsEl.classList.add('active');
        contextEl.style.display = 'block';
        contextEl.classList.add('warn');
        contextEl.textContent = details.error || response.statusText;
        startButton.disabled = false;
        return;
      }
      startButton.disabled = false;
    });
  </script>
</body>
</html>`;
}

