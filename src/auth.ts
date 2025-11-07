import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { URL } from "url";

interface StoredCredentials {
  apiKey: string;
  store?: string;
  createdAt: string;
}

export interface CredentialResolutionResult {
  apiKey: string;
  store: string;
  source: "cli" | "env" | "cache" | "browser";
}

interface ResolveCredentialsOptions {
  cliApiKey?: string;
  cliStore?: string;
  authUrl?: string;
  nonInteractive?: boolean;
  configDir?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  logger?: AuthLogger;
}

interface AuthDependencies {
  credentialsStore: CredentialsStore;
  interactiveLogin: (options: InteractiveLoginOptions) => Promise<InteractiveLoginResult>;
  now: () => Date;
}

interface InteractiveLoginOptions {
  authUrl: string;
  requestedStore: string;
  timeoutMs: number;
  logger: AuthLogger;
}

interface InteractiveLoginResult {
  apiKey: string;
  store?: string;
}

export interface AuthLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const DEFAULT_STORE = "mgrep";
const DEFAULT_AUTH_URL = "https://app.mixedbread.ai/mgrep/auth";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const defaultLogger: AuthLogger = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
};

export class CredentialsStore {
  private readonly filePath: string;

  constructor(configDir?: string) {
    this.filePath = getCredentialsFilePath(configDir);
  }

  read(): StoredCredentials | null {
    try {
      const raw = fs.readFileSync(this.filePath, { encoding: "utf-8" });
      const parsed = JSON.parse(raw);
      if (typeof parsed?.apiKey === "string") {
        return parsed;
      }
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      return null;
    }
  }

  write(creds: StoredCredentials): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, this.filePath);
  }

  clear(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
}

function getCredentialsFilePath(configDir?: string): string {
  const base =
    configDir ||
    process.env.MGREP_CONFIG_DIR ||
    (process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "mgrep")
      : path.join(os.homedir(), ".config", "mgrep"));
  return path.join(base, "credentials.json");
}

export async function resolveCredentials(
  options: ResolveCredentialsOptions = {},
  overrides?: Partial<AuthDependencies>,
): Promise<CredentialResolutionResult> {
  const env = options.env ?? process.env;
  const logger = options.logger ?? defaultLogger;
  const credentialsStore = overrides?.credentialsStore ?? new CredentialsStore(options.configDir);
  const interactiveLogin =
    overrides?.interactiveLogin ??
    ((interactiveOptions: InteractiveLoginOptions) => launchBrowserLogin(interactiveOptions));
  const now = overrides?.now ?? (() => new Date());

  const cached = credentialsStore.read();
  const storePreference = options.cliStore ?? env.MXBAI_STORE ?? cached?.store ?? DEFAULT_STORE;

  if (options.cliApiKey) {
    return { apiKey: options.cliApiKey, store: storePreference, source: "cli" };
  }

  const envKey = env.MXBAI_API_KEY;
  if (envKey) {
    return { apiKey: envKey, store: storePreference, source: "env" };
  }

  if (cached?.apiKey) {
    return {
      apiKey: cached.apiKey,
      store: cached.store ?? storePreference,
      source: "cache",
    };
  }

  const shouldBlockInteractive = options.nonInteractive ?? isEnvFlagTrue(env.MGREP_NON_INTERACTIVE);
  if (shouldBlockInteractive) {
    throw new Error(
      "No API key available and interactive login is disabled. Provide --api-key or set MXBAI_API_KEY.",
    );
  }

  const authUrl = options.authUrl ?? env.MGREP_AUTH_URL ?? DEFAULT_AUTH_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const interactiveResult = await interactiveLogin({
    authUrl,
    requestedStore: storePreference,
    timeoutMs,
    logger,
  });

  const resolvedStore = interactiveResult.store ?? storePreference;
  const payload: StoredCredentials = {
    apiKey: interactiveResult.apiKey,
    store: resolvedStore,
    createdAt: now().toISOString(),
  };
  credentialsStore.write(payload);

  return {
    apiKey: payload.apiKey,
    store: payload.store ?? storePreference,
    source: "browser",
  };
}

export class AuthCallbackServer {
  private server: Server | null = null;
  private readonly timeoutMs: number;
  private readonly logger: AuthLogger;
  private state?: string;

  constructor(timeoutMs: number, logger: AuthLogger) {
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  async start(state: string): Promise<{ callbackUrl: string }> {
    this.state = state;
    await new Promise<void>((resolve, reject) => {
      const srv = createServer((req, res) => this.handleRequest(req, res));
      srv.on("error", (err) => {
        reject(err);
      });
      srv.listen(0, "127.0.0.1", () => {
        this.server = srv;
        resolve();
      });
    });

    const address = this.server?.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to establish local auth callback server");
    }
    const callbackUrl = `http://127.0.0.1:${address.port}/callback`;
    return { callbackUrl };
  }

  waitForCredentials(): Promise<InteractiveLoginResult> {
    return new Promise<InteractiveLoginResult>((resolve, reject) => {
      if (!this.server) {
        reject(new Error("Auth callback server not initialized"));
        return;
      }
      const timer = setTimeout(() => {
        this.logger.error("Timed out waiting for Mixedbread login.");
        this.close();
        reject(new Error("Timed out waiting for login to complete."));
      }, this.timeoutMs);

      const onResult = (result: InteractiveLoginResult) => {
        clearTimeout(timer);
        this.close();
        resolve(result);
      };

      const onError = (err: Error) => {
        clearTimeout(timer);
        this.close();
        reject(err);
      };

      this.server.once("auth_result", onResult);
      this.server.once("auth_error", onError);
    });
  }

  close(): void {
    this.server?.close();
    this.server = null;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const method = (req.method ?? "GET").toUpperCase();

    if (method === "OPTIONS") {
      setCorsHeaders(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/callback") {
      respond(res, 404, "Unknown endpoint");
      return;
    }

    this.parseRequest(req, url)
      .then((result) => {
        if (this.state && result.state && this.state !== result.state) {
          throw new Error("State mismatch. Please retry login.");
        }
        const apiKey = result.apiKey;
        if (!apiKey) {
          throw new Error("No API key returned from Mixedbread login.");
        }
        const payload: InteractiveLoginResult = {
          apiKey,
          store: result.store,
        };
        respond(res, 200, "Login complete! You can return to your terminal.");
        this.server?.emit("auth_result", payload);
      })
      .catch((err: Error) => {
        respond(res, 400, err.message);
        this.server?.emit("auth_error", err);
      });
  }

  private async parseRequest(
    req: IncomingMessage,
    url: URL,
  ): Promise<{ apiKey?: string; store?: string; state?: string }> {
    const method = (req.method ?? "GET").toUpperCase();

    if (method === "GET") {
      return {
        apiKey: getFirst(url.searchParams, ["apiKey", "api_key", "token", "access_token"]),
        store: getFirst(url.searchParams, ["store"]),
        state: url.searchParams.get("state") ?? undefined,
      };
    }

    if (method === "POST") {
      const body = await readBody(req);
      const payload = tryParseBody(body, req.headers["content-type"]);
      return {
        apiKey: payload.apiKey ?? payload.api_key ?? payload.token ?? payload.access_token,
        store: payload.store ?? payload.store_id ?? payload.storeName,
        state: payload.state,
      };
    }

    throw new Error(`Unsupported method: ${req.method}`);
  }
}

async function launchBrowserLogin(options: InteractiveLoginOptions): Promise<InteractiveLoginResult> {
  const state = randomBytes(16).toString("hex");
  const server = new AuthCallbackServer(options.timeoutMs, options.logger);
  const { callbackUrl } = await server.start(state);
  const loginUrl = buildLoginUrl(options.authUrl, callbackUrl, state, options.requestedStore);
  options.logger.info(`Opening Mixedbread login at: ${loginUrl}`);
  options.logger.info("If the browser does not open automatically, copy the URL above.");
  try {
    await openInBrowser(loginUrl);
  } catch (err) {
    server.close();
    throw err;
  }
  return server.waitForCredentials();
}

function buildLoginUrl(authUrl: string, callbackUrl: string, state: string, store: string): string {
  const url = new URL(authUrl);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("state", state);
  url.searchParams.set("client", "mgrep");
  if (store) {
    url.searchParams.set("store", store);
  }
  return url.toString();
}

function isEnvFlagTrue(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes"].includes(value.toLowerCase());
}

function getFirst(params: URLSearchParams, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = params.get(key);
    if (val) return val;
  }
  return undefined;
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", (err) => reject(err));
  });
}

function tryParseBody(body: string, contentType: string | string[] | undefined): Record<string, string | undefined> {
  if (!body) return {};
  if (typeof contentType === "string" && contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") {
        const record: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string") {
            record[key] = value;
          }
        }
        return record;
      }
    } catch {
      return {};
    }
  }

  if (typeof contentType === "string" && contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(body);
    const result: Record<string, string | undefined> = {};
    params.forEach((v, k) => {
      result[k] = v;
    });
    return result;
  }

  return {};
}

function openInBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let command: string;
    let args: string[];
    if (platform === "darwin") {
      command = "open";
      args = [url];
    } else if (platform === "win32") {
      command = "cmd";
      const escapedUrl = url.replace(/&/g, "^&");
      args = ["/c", "start", "", escapedUrl];
    } else {
      command = "xdg-open";
      args = [url];
    }

    let child;
    try {
      child = spawn(command, args, { detached: true, stdio: "ignore" });
    } catch (err) {
      reject(err);
      return;
    }

    const cleanup = () => {
      child.removeListener("error", handleError);
      child.removeListener("spawn", handleSpawn);
    };

    const handleError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const handleSpawn = () => {
      cleanup();
      child.unref();
      resolve();
    };

    child.once("error", handleError);
    child.once("spawn", handleSpawn);
  });
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function respond(res: ServerResponse, status: number, message: string): void {
  setCorsHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<html><body><h3>${status >= 400 ? "Authorization failed" : "Success"}</h3><p>${escapeHtml(
      message,
    )}</p></body></html>`,
  );
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

export const __internal = {
  CredentialsStore,
  buildLoginUrl,
  tryParseBody,
  isEnvFlagTrue,
  AuthCallbackServer,
  DEFAULT_AUTH_URL,
};
