export const MCP_ROUTE = "/v1";

/**
 * OAuthProvider uses prefix matching for API routes. Keep the public endpoint
 * exact so `/v1/`, `/v10`, and `/v1/tools` cannot be mistaken for this MCP
 * resource.
 */
export function isRejectedMcpRouteLookalike(pathname: string): boolean {
  return pathname.startsWith(MCP_ROUTE) && pathname !== MCP_ROUTE;
}
