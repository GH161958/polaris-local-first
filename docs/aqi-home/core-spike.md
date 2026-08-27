# Aqi Home · Temporary Core Contract Spike

Status: experimental  
Branch: `feat/aqi-home-core-spike`  
Upstream base: `Aevella/polaris-local-first@a510f9ae68a70dead5ad344829466d3e5770f600`

## Purpose

This fork is currently a **temporary Polaris shell**, not the canonical Aqi Home Core.

The spike answers one question only:

> Can Polaris send its built-in OpenAI-compatible chat request to an endpoint we control and consume a streamed reply correctly?

No model provider, Memory bridge, Chat Ledger persistence, auth, or production backend ownership is introduced here.

## Probe

Run:

```bash
npm run aqi:core-probe
```

The probe binds to:

```text
http://127.0.0.1:8788
```

Routes:

```text
GET  /health
GET  /api/health
POST /api/chat/completions
```

The chat route returns an OpenAI-compatible SSE stream containing:

```text
阿栖收到 ovo
```

It intentionally:

- does not call any model provider;
- does not persist prompts or replies;
- does not log raw chat content;
- is not Aqi Home Core;
- exists only to verify the Polaris ↔ owned-backend contract.

## Polaris local setup

Create a local env file:

```bash
cp .env.example .env.local
```

Set:

```text
VITE_POLARIS_API_ORIGIN=http://127.0.0.1:8788
```

Then use two terminals.

Terminal A:

```bash
npm run aqi:core-probe
```

Terminal B:

```bash
npm run dev
```

For Vite development, Polaris already proxies relative `/api` requests to `VITE_POLARIS_API_ORIGIN`.

Use the built-in Polaris provider so the request path remains:

```text
/api/chat/completions
```

Expected result:

```text
Polaris
→ Vite /api proxy
→ 127.0.0.1:8788/api/chat/completions
→ OpenAI-compatible SSE
→ “阿栖收到 ovo”
```

## Acceptance

This spike is green when all are true:

1. `GET /health` returns `ok: true`.
2. Polaris sends a request through the configured API origin.
3. The browser receives a streaming response, not a single fake DOM injection.
4. Polaris renders `阿栖收到 ovo`.
5. No UI source code was changed to make the test pass.
6. No Memory, Vault, Drawer, Ledger, or provider secret was added to this fork.

## Boundary after acceptance

Once this contract is proven:

```text
Polaris fork
= temporary replaceable shell

future independent Aqi Home Core
= Gateway / Provider Adapter / Ledger / Memory bridge / Auth / Backup
```

Do not grow production Core ownership inside this AGPL Polaris fork merely because the probe lives here.

## Local probe verification

The probe script was syntax-checked with Node and smoke-tested independently with:

```bash
curl http://127.0.0.1:8788/health

curl -N \
  -H 'Content-Type: application/json' \
  -d '{"model":"Polaris","stream":true,"messages":[{"role":"user","content":"阿栖？"}]}' \
  http://127.0.0.1:8788/api/chat/completions
```

Expected SSE ends with:

```text
data: [DONE]
```

## Provenance

- Upstream: https://github.com/Aevella/polaris-local-first
- Upstream license: AGPL-3.0-only
- Upstream backend-origin mechanism: `VITE_POLARIS_API_ORIGIN`
- Relevant upstream modules:
  - `src/engines/chat-api/chatApiEndpoint.ts`
  - `src/engines/chat-api/chatApiTransport.ts`
  - `src/engines/freeProvider.ts`
  - `vite.config.ts`
  - `docs/connect-your-own-backend.md`

Aqi-specific additions in this branch are an internal contract probe and integration notes; they do not claim to replace Polaris's backend architecture.
