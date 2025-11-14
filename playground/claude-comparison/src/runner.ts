import { spawn } from "child_process";
import { createInterface } from "readline";
import { Mixedbread } from "@mixedbread/sdk";

export type PlaygroundConfig = {
  prompt: string;
  store: string;
  topK: number;
  model: string;
  claudeBin: string;
  maxContextChars: number;
  enableContext?: boolean;
};

export type RetrievedChunk = {
  path: string;
  text: string;
  score: number;
};

export type PlaygroundEvent =
  | {
      type: "text";
      lane: string;
      laneKind: LaneKind;
      text: string;
      raw?: unknown;
      timestamp: number;
    }
  | {
      type: "read";
      lane: string;
      laneKind: LaneKind;
      text: string;
      timestamp: number;
    }
  | {
      type: "grep";
      lane: string;
      laneKind: LaneKind;
      text: string;
      timestamp: number;
    }
  | {
      type: "think";
      lane: string;
      laneKind: LaneKind;
      text: string;
      timestamp: number;
    }
  | {
      type: "stderr";
      lane: string;
      laneKind: LaneKind;
      text: string;
      timestamp: number;
    }
  | {
      type: "stop";
      lane: string;
      laneKind: LaneKind;
      timestamp: number;
    }
  | {
      type: "exit";
      lane: string;
      laneKind: LaneKind;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      timestamp: number;
    }
  | {
      type: "error";
      lane: string;
      laneKind: LaneKind;
      message: string;
      timestamp: number;
    };

export type PlaygroundHooks = {
  onEvent?: (event: PlaygroundEvent) => void;
  onLaneStart?: (lane: LaneDescriptor) => void;
  onLaneComplete?: (summary: LaneSummary) => void;
  onContextReady?: (context: {
    available: boolean;
    chunks: RetrievedChunk[];
    warning?: string;
  }) => void;
};

export type RunSummary = {
  context: {
    available: boolean;
    chunks: RetrievedChunk[];
    warning?: string;
  };
  lanes: LaneSummary[];
};

export type LaneSummary = {
  label: string;
  kind: LaneKind;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

type LaneKind = "with-context" | "baseline";

type LaneDescriptor = {
  label: string;
  prompt: string;
  kind: LaneKind;
};

export async function runPlayground(
  config: PlaygroundConfig,
  hooks: PlaygroundHooks = {},
): Promise<RunSummary> {
  const { onEvent, onLaneStart, onLaneComplete, onContextReady } = hooks;
  let contextAvailable = false;
  let contextWarning: string | undefined;
  let contextPrompt = config.prompt;
  let contextChunks: RetrievedChunk[] = [];

  if (config.enableContext !== false) {
    try {
      contextChunks = await fetchContext(config);
      if (contextChunks.length > 0) {
        contextAvailable = true;
        contextPrompt = buildContextPrompt(
          config.prompt,
          contextChunks,
          config.maxContextChars,
        );
      } else {
        contextWarning = `No Mixedbread results returned for store "${config.store}".`;
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to retrieve Mixedbread context.";
      contextWarning = message;
      contextAvailable = false;
    }
  }

  onContextReady?.({
    available: contextAvailable,
    chunks: contextChunks,
    warning: contextWarning,
  });

  const lanes: LaneDescriptor[] = [];
  if (contextAvailable) {
    lanes.push({
      label: "Claude Code + mgrep",
      prompt: contextPrompt,
      kind: "with-context",
    });
  }
  lanes.push({
    label: "Claude Code (no mgrep)",
    prompt: config.prompt,
    kind: "baseline",
  });

  const summaries: LaneSummary[] = [];

  for (const lane of lanes) {
    onLaneStart?.(lane);
  }

  const results = await Promise.all(
    lanes.map((lane) =>
      spawnClaudeLane(
        lane,
        config,
        (event) => {
          onEvent?.(event);
        },
        (summary) => {
          onLaneComplete?.(summary);
        },
      ),
    ),
  );

  for (const summary of results) {
    summaries.push(summary);
  }

  return {
    context: {
      available: contextAvailable,
      chunks: contextChunks,
      warning: contextWarning,
    },
    lanes: summaries,
  };
}

async function fetchContext(config: PlaygroundConfig): Promise<RetrievedChunk[]> {
  if (!process.env.MXBAI_API_KEY) {
    throw new Error(
      "MXBAI_API_KEY is not set. Export a Mixedbread API key to enable the mgrep lane.",
    );
  }

  const client = new Mixedbread({
    apiKey: process.env.MXBAI_API_KEY,
  });

  const response = await client.stores.search({
    query: config.prompt,
    store_identifiers: [config.store],
    limit: config.topK,
  });

  return response.data
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => ({
      path:
        ((item.metadata as Record<string, unknown>)?.path as string | undefined) ??
        "Unknown path",
      text: (item.text as string) ?? "",
      score: typeof item.score === "number" ? item.score : 0,
    }));
}

function buildContextPrompt(
  prompt: string,
  chunks: RetrievedChunk[],
  maxChars: number,
): string {
  if (chunks.length === 0) {
    return prompt;
  }

  const sections: string[] = [];
  let remaining = maxChars;

  for (const chunk of chunks) {
    const header = `Source: ${chunk.path} (score ${chunk.score.toFixed(3)})`;
    const snippet = chunk.text.slice(0, remaining);
    remaining -= snippet.length;
    if (remaining < 0) {
      break;
    }
    sections.push(`${header}\n${snippet}`);
    if (remaining <= 0) {
      break;
    }
  }

  const joined = sections.join("\n\n---\n\n");

  return [
    "You are comparing two runs of the same prompt.",
    "Use the retrieved Mixedbread context below when it is relevant.",
    "Cite file paths when deriving answers from specific sources.",
    "",
    "Retrieved context:",
    joined,
    "",
    "Original prompt:",
    prompt,
  ].join("\n");
}

function spawnClaudeLane(
  lane: LaneDescriptor,
  config: PlaygroundConfig,
  onEvent: (event: PlaygroundEvent) => void,
  onComplete: (summary: LaneSummary) => void,
): Promise<LaneSummary> {
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();
    const child = spawn(
      config.claudeBin,
      [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        config.model,
        lane.prompt,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
        },
      },
    );

    const rl = createInterface({ input: child.stdout });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      const timestamp = Date.now();
      try {
        const parsed = JSON.parse(trimmed) as {
          type?: string;
          subtype?: string;
          delta?: { type?: string; text?: string };
          content_block?: { type?: string; text?: string };
          message?: { content?: Array<{ text?: string }>; stop_reason?: string };
          error?: { message?: string };
          tool_use?: { name?: string; input?: unknown };
          tool_result?: { tool_use_id?: string; content?: string };
        };
        
        if (parsed.type === "assistant" && parsed.subtype === "tool_use") {
          const toolName = parsed.tool_use?.name?.toLowerCase() || "";
          const input = parsed.tool_use?.input;
          let toolText = "";
          if (typeof input === "object" && input !== null) {
            if ("path" in input && typeof input.path === "string") {
              toolText = input.path;
            } else if ("pattern" in input && typeof input.pattern === "string") {
              toolText = input.pattern;
            } else {
              toolText = JSON.stringify(input);
            }
          }
          
          if (toolName.includes("read") || toolName === "read") {
            onEvent({
              type: "read",
              lane: lane.label,
              laneKind: lane.kind,
              text: toolText,
              timestamp,
            });
          } else if (toolName.includes("grep") || toolName === "grep") {
            onEvent({
              type: "grep",
              lane: lane.label,
              laneKind: lane.kind,
              text: toolText,
              timestamp,
            });
          }
        } else if (parsed.type === "assistant" && parsed.subtype === "thinking") {
          onEvent({
            type: "think",
            lane: lane.label,
            laneKind: lane.kind,
            text: "Thinking...",
            timestamp,
          });
        } else {
          switch (parsed.type) {
            case "message":
              if (parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (typeof block.text === "string" && block.text.length > 0) {
                    onEvent({
                      type: "text",
                      lane: lane.label,
                      laneKind: lane.kind,
                      text: block.text,
                      raw: parsed,
                      timestamp,
                    });
                  }
                }
              }
              if (parsed.message?.stop_reason) {
                onEvent({
                  type: "stop",
                  lane: lane.label,
                  laneKind: lane.kind,
                  timestamp,
                });
              }
              break;
            case "content_block_delta":
              if (parsed.delta?.type === "text_delta" && parsed.delta.text) {
                onEvent({
                  type: "text",
                  lane: lane.label,
                  laneKind: lane.kind,
                  text: parsed.delta.text,
                  raw: parsed,
                  timestamp,
                });
              }
              break;
            case "content_block":
              if (parsed.content_block?.type === "text" && parsed.content_block.text) {
                onEvent({
                  type: "text",
                  lane: lane.label,
                  laneKind: lane.kind,
                  text: parsed.content_block.text,
                  raw: parsed,
                  timestamp,
                });
              }
              break;
            case "message_delta":
              break;
            case "message_stop":
              onEvent({
                type: "stop",
                lane: lane.label,
                laneKind: lane.kind,
                timestamp,
              });
              break;
            case "error":
              onEvent({
                type: "error",
                lane: lane.label,
                laneKind: lane.kind,
                message: parsed.error?.message ?? "Unknown error",
                timestamp,
              });
              break;
            default:
              if (parsed.content_block?.text) {
                onEvent({
                  type: "text",
                  lane: lane.label,
                  laneKind: lane.kind,
                  text: parsed.content_block.text,
                  raw: parsed,
                  timestamp,
                });
              } else if (parsed.delta?.text) {
                onEvent({
                  type: "text",
                  lane: lane.label,
                  laneKind: lane.kind,
                  text: parsed.delta.text,
                  raw: parsed,
                  timestamp,
                });
              }
          }
        }
      } catch {
        const lower = trimmed.toLowerCase();
        if (lower.includes("read") && (lower.includes("/") || lower.includes("file"))) {
          onEvent({
            type: "read",
            lane: lane.label,
            laneKind: lane.kind,
            text: trimmed,
            timestamp,
          });
        } else if (lower.includes("grep") || lower.includes("search")) {
          onEvent({
            type: "grep",
            lane: lane.label,
            laneKind: lane.kind,
            text: trimmed,
            timestamp,
          });
        } else {
          onEvent({
            type: "text",
            lane: lane.label,
            laneKind: lane.kind,
            text: trimmed,
            timestamp,
          });
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        const lower = text.toLowerCase();
        if (lower.includes("read") && (lower.includes("/") || lower.includes("file") || lower.includes("path"))) {
          onEvent({
            type: "read",
            lane: lane.label,
            laneKind: lane.kind,
            text: text.replace(/^.*?read/i, "").trim() || text,
            timestamp: Date.now(),
          });
        } else if (lower.includes("grep") || (lower.includes("search") && lower.includes("pattern"))) {
          onEvent({
            type: "grep",
            lane: lane.label,
            laneKind: lane.kind,
            text: text.replace(/^.*?grep/i, "").trim() || text,
            timestamp: Date.now(),
          });
        } else if (lower.includes("think") || lower.includes("reasoning")) {
          onEvent({
            type: "think",
            lane: lane.label,
            laneKind: lane.kind,
            text: text,
            timestamp: Date.now(),
          });
        } else {
          onEvent({
            type: "stderr",
            lane: lane.label,
            laneKind: lane.kind,
            text,
            timestamp: Date.now(),
          });
        }
      }
    });

    child.on("error", (err) => {
      const nodeErr = err as NodeJS.ErrnoException;
      const friendlyMessage =
        nodeErr.code === "ENOENT"
          ? `Claude CLI not found at "${config.claudeBin}". Install it (e.g. via "npm install -g @anthropic-ai/claude-cli") or set CLAUDE_BIN.`
          : nodeErr.message;
      onEvent({
        type: "error",
        lane: lane.label,
        laneKind: lane.kind,
        message: friendlyMessage,
        timestamp: Date.now(),
      });
      reject(new Error(friendlyMessage));
    });

    child.on("close", (code, signal) => {
      rl.close();
      const endedAt = process.hrtime.bigint();
      const durationMs = Number(endedAt - startedAt) / 1_000_000;

      const summary: LaneSummary = {
        label: lane.label,
        kind: lane.kind,
        durationMs,
        exitCode: typeof code === "number" ? code : null,
        signal: signal ?? null,
      };

      onEvent({
        type: "exit",
        lane: lane.label,
        laneKind: lane.kind,
        exitCode: summary.exitCode,
        signal: summary.signal,
        timestamp: Date.now(),
      });

      onComplete(summary);

      if (signal) {
        reject(new Error(`Claude lane ${lane.label} terminated by signal ${signal}`));
        return;
      }

      resolve(summary);
    });
  });
}

