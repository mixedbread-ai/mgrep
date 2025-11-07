# Authentication Frontend Contract

To unblock the CLI experience we need a lightweight FE entry point that hands an API key (or short-lived token) back to `mgrep`. The CLI now exposes the following contract and the production implementation lives at `https://app.mixedbread.ai/mgrep/auth`:

1. `mgrep` starts a local HTTP server on `http://127.0.0.1:<port>/callback` and appends the URL (plus a random `state` string) to the auth page query parameters.
2. The FE page should authenticate the user via Mixedbread, mint an API key (or other credential), and redirect the browser back to the callback with the same `state`.
3. The hand-off can be either:
   - Navigate the browser to `http://127.0.0.1:<port>/callback?apiKey=...&store=...&state=...`, **or**
   - Issue a `POST` (JSON or `application/x-www-form-urlencoded`) to the callback URL. The CLI now responds with permissive CORS headers and accepts `OPTIONS` preflight requests so the FE can call it via `fetch`.
4. Fields accepted by the CLI callback server:
   - `apiKey`, `api_key`, `token`, or `access_token` (string, required)
   - `store`, `store_id`, or `storeName` (string, optional)
   - `state` (string, optional but recommended — allows the CLI to enforce CSRF protection)

If the FE does not know which store to use, it can omit that field; the CLI will default to `mgrep` or whatever the operator passed via `--store`. The prod page mirrors this behavior by defaulting to `mgrep` while still echoing any explicit `store` query parameter from the CLI.

## Production flow

1. The CLI opens `https://app.mixedbread.ai/mgrep/auth?redirect_uri=...&state=...&store=...`.
2. The page forces a sign-in (using Better Auth). If the user lacks an organization we redirect them to `/onboarding` first.
3. Once authenticated we mint an API key via the Mixedbread admin API (`createApiKey`) and render it so the operator can copy it.
4. The page immediately `POST`s the payload `{ apiKey, store, state }` to the provided `redirect_uri`. We also provide a manual “Open callback manually” button that navigates to the callback with query parameters for older CLI binaries.
5. If the automatic send fails, we show the error and offer to retry, open the callback in a new tab, or copy an `export MXBAI_API_KEY="..."` snippet.

## Local testing

You can override the FE URL via:

```bash
mgrep --auth-url http://localhost:3000/mgrep-auth
```

Or set `MGREP_AUTH_URL`. That lets you point at a staging FE server while developing.
