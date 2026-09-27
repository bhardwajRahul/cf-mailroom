import assert from "node:assert/strict";
import test from "node:test";
import {
  isRejectedMcpRouteLookalike,
  MCP_ROUTE,
} from "../src/mcp/route.ts";

test("the only MCP endpoint is the slashless /mcp path", () => {
  assert.equal(MCP_ROUTE, "/mcp");
  assert.equal(isRejectedMcpRouteLookalike("/mcp"), false);
});

test("trailing-slash and prefix lookalikes are rejected", () => {
  for (const path of ["/mcp/", "/mcpx", "/mcp-foo", "/mcp/tools"]) {
    assert.equal(isRejectedMcpRouteLookalike(path), true);
  }
  for (const path of ["/oauth/mcp", "/api/mcp", "/inbox", "/.well-known/oauth-protected-resource/mcp"]) {
    assert.equal(isRejectedMcpRouteLookalike(path), false);
  }
});
