# wacrm MCP usage guide

This guide shows how to run the `wacrm-mcp` server, secure it, and connect it to AI agents such as Claude Desktop, Claude Code, Cursor, and Streamable HTTP-capable agents.

Your dashboard is available at https://wacrm-nu.vercel.app/

## 1. Install and build the MCP server

From the repo root:

```bash
cd wacrm
cd mcp-server
npm install
npm run build
```

## 2. Set required environment variables

Required variables:

- `WACRM_BASE_URL`: Your CRM URL, for example `https://wacrm-nu.vercel.app`
- `WACRM_API_KEY`: A dashboard API key created in **Settings → API keys**

Optional controls:

- `WACRM_ENABLE_WRITES=true`: expose contact writes and message sending
- `WACRM_ENABLE_BROADCASTS=true`: expose broadcast tools
- `WACRM_ENABLE_WEBHOOKS=true`: expose webhook management tools
- `WACRM_SCOPE_FILTER=contacts:read,conversations:read`: explicitly allow only these scopes
- `WACRM_HTTP_PORT=3001`: run Streamable HTTP transport
- `WACRM_HTTP_AUTH_TOKEN=supersecret`: require bearer token on HTTP connections

## 3. Run the server

### Local stdio MCP transport

```bash
WACRM_BASE_URL=https://wacrm-nu.vercel.app \
WACRM_API_KEY=wacrm_live_xxx \
node dist/index.js
```

If you want writes and webhook management:

```bash
WACRM_BASE_URL=https://wacrm-nu.vercel.app \
WACRM_API_KEY=wacrm_live_xxx \
WACRM_ENABLE_WRITES=true \
WACRM_ENABLE_BROADCASTS=true \
WACRM_ENABLE_WEBHOOKS=true \
node dist/index.js
```

### Streamable HTTP transport for web-based agents

```bash
WACRM_BASE_URL=https://wacrm-nu.vercel.app \
WACRM_API_KEY=wacrm_live_xxx \
WACRM_ENABLE_WRITES=true \
WACRM_HTTP_PORT=3001 \
WACRM_HTTP_AUTH_TOKEN=supersecret \
node dist/index.js
```

This exposes:

- `GET /health`
- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`

## 4. Connect Claude Desktop / Claude Code / Cursor

Use `npx wacrm-mcp` as the MCP command and pass your environment variables.

Example `claude_desktop_config.json` or `.mcp.json`:

```jsonc
{
  "mcpServers": {
    "wacrm": {
      "command": "npx",
      "args": ["-y", "wacrm-mcp"],
      "env": {
        "WACRM_BASE_URL": "https://wacrm-nu.vercel.app",
        "WACRM_API_KEY": "wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxx",
        "WACRM_ENABLE_WRITES": "true",
        "WACRM_ENABLE_BROADCASTS": "true",
        "WACRM_ENABLE_WEBHOOKS": "true"
      }
    }
  }
}
```

### Safe setup

For read-only use, omit `WACRM_ENABLE_WRITES`. That ensures the assistant cannot send messages or modify contacts.

## 5. Connect web agents like Claude or Hermes

For agents that support Streamable HTTP, point them at the running MCP server endpoint.

Example configuration:

- MCP endpoint: `http://localhost:3001/mcp`
- auth header: `Authorization: Bearer supersecret`

If using `WACRM_HTTP_AUTH_TOKEN`, every HTTP client must send the bearer token.

Initialize with `POST /mcp`. The server returns an `mcp-session-id`
header; send that header on later `POST /mcp` requests, `GET /mcp`
stream connections, and `DELETE /mcp` session termination requests.

## 6. Tool availability and scopes

The MCP server exposes tools based on three layers:

1. `WACRM_ENABLE_WRITES`, `WACRM_ENABLE_BROADCASTS`, `WACRM_ENABLE_WEBHOOKS` — tool groups are registered only when explicitly enabled.
2. `WACRM_SCOPE_FILTER` — optional allowlist to restrict tool visibility further.
3. API-key scopes returned by your wacrm instance — the server only allows actions your key is authorized for.

Common scopes:

- `contacts:read`
- `contacts:write`
- `conversations:read`
- `messages:read`
- `messages:send`
- `broadcasts:send`
- `webhooks:manage`

## 7. Example flows

### Read-only assistant

- `WACRM_ENABLE_WRITES` not set
- API key only has `contacts:read`, `conversations:read`, `messages:read`

This setup can answer questions about contacts and conversations but cannot send WhatsApp messages.

### Assistant that can message customers

- `WACRM_ENABLE_WRITES=true`
- API key includes `messages:send` and `contacts:write`

This setup can create or update contacts and send messages through the CRM.

### Agent that manages webhooks

- `WACRM_ENABLE_WEBHOOKS=true`
- API key includes `webhooks:manage`

The assistant can create, update, and delete webhook endpoints via the MCP tools.

## 8. Troubleshooting

- If the agent cannot see writes, verify `WACRM_ENABLE_WRITES=true` and the API key includes `messages:send`.
- If the HTTP agent cannot connect, verify `WACRM_HTTP_PORT` and `WACRM_HTTP_AUTH_TOKEN`.
- If the assistant sees no tools, check `WACRM_SCOPE_FILTER` and the actual scopes returned by the key.
- If an older client asks for `/sse` or `/message`, upgrade it to Streamable HTTP and use `/mcp`.

## 9. Recommended workflow

1. Start with a read-only key and no write flags.
2. Validate the agent can see contacts and conversations.
3. Add `WACRM_ENABLE_WRITES=true` only when you want message/send capability.
4. Use `WACRM_SCOPE_FILTER` to reduce the visible surface area for more security.
