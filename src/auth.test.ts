import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AuthCallbackServer, CredentialsStore, resolveCredentials, __internal } from "./auth";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mgrep-auth-test-"));
}

const noopLogger = {
  info: () => {
    /* noop */
  },
  warn: () => {
    /* noop */
  },
  error: () => {
    /* noop */
  },
};

describe("CredentialsStore", () => {
  it("persists and retrieves credentials", () => {
    const dir = createTempDir();
    const store = new CredentialsStore(dir);
    const now = new Date().toISOString();
    store.write({ apiKey: "abc123", store: "foo", createdAt: now });
    const readBack = store.read();
    expect(readBack).toEqual({ apiKey: "abc123", store: "foo", createdAt: now });
  });

  it("clears stored credentials", () => {
    const dir = createTempDir();
    const store = new CredentialsStore(dir);
    store.write({
      apiKey: "abc123",
      store: "foo",
      createdAt: new Date().toISOString(),
    });
    store.clear();
    expect(store.read()).toBeNull();
  });
});

describe("resolveCredentials", () => {
  const baseDeps = (configDir?: string) => ({
    credentialsStore: new CredentialsStore(configDir),
    interactiveLogin: vi.fn(),
    now: () => new Date("2024-01-01T00:00:00.000Z"),
  });

  it("prefers CLI credentials", async () => {
    const result = await resolveCredentials(
      { cliApiKey: "cli-key", cliStore: "cli-store" },
      baseDeps(createTempDir()),
    );
    expect(result).toEqual({ apiKey: "cli-key", store: "cli-store", source: "cli" });
  });

  it("falls back to environment credentials", async () => {
    const result = await resolveCredentials(
      { env: { MXBAI_API_KEY: "env-key", MXBAI_STORE: "env-store" } },
      baseDeps(createTempDir()),
    );
    expect(result.apiKey).toBe("env-key");
    expect(result.store).toBe("env-store");
    expect(result.source).toBe("env");
  });

  it("uses cached credentials when available", async () => {
    const dir = createTempDir();
    const store = new CredentialsStore(dir);
    store.write({
      apiKey: "cached",
      store: "cached-store",
      createdAt: new Date().toISOString(),
    });
    const result = await resolveCredentials({}, {
      ...baseDeps(dir),
      credentialsStore: store,
    });
    expect(result.apiKey).toBe("cached");
    expect(result.store).toBe("cached-store");
    expect(result.source).toBe("cache");
  });

  it("launches interactive login when nothing else is available", async () => {
    const dir = createTempDir();
    const interactiveLogin = vi.fn().mockResolvedValue({ apiKey: "browser", store: "browser-store" });
    const deps = {
      ...baseDeps(dir),
      credentialsStore: new CredentialsStore(dir),
      interactiveLogin,
    };
    const result = await resolveCredentials(
      { authUrl: "https://example.com/login", timeoutMs: 3000 },
      deps,
    );
    expect(interactiveLogin).toHaveBeenCalledWith({
      authUrl: "https://example.com/login",
      requestedStore: "mgrep",
      timeoutMs: 3000,
      logger: expect.anything(),
    });
    expect(result.apiKey).toBe("browser");
    expect(result.store).toBe("browser-store");
    expect(result.source).toBe("browser");
    const cached = deps.credentialsStore.read();
    expect(cached?.apiKey).toBe("browser");
  });

  it("honors the non-interactive flag", async () => {
    await expect(
      resolveCredentials({ nonInteractive: true }, baseDeps(createTempDir())),
    ).rejects.toThrow(/No API key available/);
  });
});

describe("AuthCallbackServer", () => {
  it("captures credentials sent via query parameters", async () => {
    const server = new AuthCallbackServer(2000, noopLogger);
    const state = "state-123";
    const { callbackUrl } = await server.start(state);
    const waitPromise = server.waitForCredentials();
    const url = new URL(callbackUrl);
    url.searchParams.set("apiKey", "returned-key");
    url.searchParams.set("store", "store-123");
    url.searchParams.set("state", state);
    await fetch(url.toString());
    const result = await waitPromise;
    expect(result.apiKey).toBe("returned-key");
    expect(result.store).toBe("store-123");
  });

  it("rejects when state mismatches", async () => {
    const server = new AuthCallbackServer(2000, noopLogger);
    const { callbackUrl } = await server.start("expected");
    const waitPromise = server.waitForCredentials();
    const url = new URL(callbackUrl);
    url.searchParams.set("apiKey", "returned-key");
    url.searchParams.set("state", "other");
    const requestPromise = fetch(url.toString());
    await expect(waitPromise).rejects.toThrow(/State mismatch/);
    await requestPromise;
  });

  it("responds to OPTIONS with CORS headers", async () => {
    const server = new AuthCallbackServer(2000, noopLogger);
    const { callbackUrl } = await server.start("state");
    const response = await fetch(callbackUrl, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    server.close();
  });
});

describe("helpers", () => {
  it("parses form-encoded bodies", () => {
    const parsed = __internal.tryParseBody("apiKey=test&store=my-store", "application/x-www-form-urlencoded");
    expect(parsed).toEqual({ apiKey: "test", store: "my-store" });
  });

  it("detects truthy env flags", () => {
    expect(__internal.isEnvFlagTrue("1")).toBe(true);
    expect(__internal.isEnvFlagTrue("true")).toBe(true);
    expect(__internal.isEnvFlagTrue("nope")).toBe(false);
  });
});
