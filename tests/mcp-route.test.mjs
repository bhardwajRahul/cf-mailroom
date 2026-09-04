import assert from "node:assert/strict";
import test from "node:test";
import {
  isRejectedMcpRouteLookalike,
  MCP_ROUTE,
} from "../src/mcp/route.ts";

test("the only MCP endpoint is the slashless /v1 path", () => {
  assert.equal(MCP_ROUTE, "/v1");
  assert.equal(isRejectedMcpRouteLookalike("/v1"), false);
});

test("trailing-slash and prefix lookalikes are rejected", () => {
  for (const path of ["/v1/", "/v10", "/v1foo", "/v1/tools"]) {
    assert.equal(isRejectedMcpRouteLookalike(path), true);
  }
  assert.equal(isRejectedMcpRouteLookalike("/oauth/v1"), false);
});
