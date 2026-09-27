export const MCP_ROUTE = "/mcp";

/**
 * OAuthProvider uses prefix matching for API routes. Keep the public endpoint
 * exact so `/mcp/`, `/mcpx`, and `/mcp/tools` cannot be mistaken for this MCP
 * resource.
 */
export function isRejectedMcpRouteLookalike(pathname: string): boolean {
  return pathname.startsWith(MCP_ROUTE) && pathname !== MCP_ROUTE;
}
