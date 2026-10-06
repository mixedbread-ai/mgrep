import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const args = process.argv.slice(2);
const separator = args.indexOf("--");
if (separator < 0) {
  throw new Error(
    "Usage: mcp-client.mjs initialize|list|call <name> <json>|calls <json>|close|eof -- <mgrep args>",
  );
}
const [action, name, json] = args.slice(0, separator);
const transport = new StdioClientTransport({
  command: "mgrep",
  args: args.slice(separator + 1),
  env: process.env,
  stderr: "pipe",
});
const roots = process.env.MGREP_MCP_ROOTS;
const client = new Client(
  { name: "mgrep-test", version: "1.0.0" },
  {
    capabilities: roots !== undefined ? { roots: {} } : {},
  },
);
if (roots !== undefined) {
  client.setRequestHandler(ListRootsRequestSchema, async () => {
    if (process.env.MGREP_MCP_FORBID_ROOTS)
      throw new Error("Unexpected roots/list");
    return { roots: JSON.parse(roots) };
  });
}
let stderr = "";
transport.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
const timeout = setTimeout(() => {
  console.error(`MCP client timed out\n${stderr}`);
  void client.close().finally(() => process.exit(1));
}, 15000);

try {
  await client.connect(transport);
  const waitFor = process.env.MGREP_MCP_WAIT_FOR;
  while (waitFor && !stderr.includes(waitFor)) {
    if (transport.pid === null) throw new Error("MCP server exited early");
    await delay(25);
  }

  let result;
  switch (action) {
    case "initialize":
      result = { instructions: client.getInstructions() };
      break;
    case "list":
      result = await client.listTools();
      break;
    case "call-with-logs":
    case "call":
      result = await client.callTool({ name, arguments: JSON.parse(json) });
      await client.ping();
      break;
    case "calls-with-logs":
    case "calls":
      result = [];
      for (const step of JSON.parse(name)) {
        if (step.write) writeFileSync(step.write.path, step.write.text);
        else
          result.push(
            await client.callTool({ name: "search", arguments: step }),
          );
      }
      await client.ping();
      break;
    case "idle":
      await delay(1500);
      await client.ping();
      result = { stderr };
      break;
    case "close":
    case "eof": {
      // SDK 1.22 close() sends SIGTERM; use its child stdin to test EOF separately.
      const child = transport._process;
      const exited = new Promise((resolve) => {
        child.once("exit", (code, signal) => resolve([code, signal]));
      });
      if (action === "eof") child.stdin.end();
      else await client.close();
      const [code, signal] = await exited;
      assert.equal(code, 0);
      assert.equal(signal, null);
      result = { exited: true, code, signal };
      break;
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
  if (action.endsWith("-with-logs")) result = { result, stderr };
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(stderr);
  throw error;
} finally {
  clearTimeout(timeout);
  await client.close();
}
