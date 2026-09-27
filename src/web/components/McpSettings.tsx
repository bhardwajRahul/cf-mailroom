import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CopyField } from "./CopyField";
import { SettingsBlock, SettingsPanel } from "./SettingsNavigation";

/**
 * MCP clients must reach discovery, registration, token, and /mcp without an
 * Access session. Fetching without cookies shows whether Access intercepts them.
 */
async function checkPublicOAuth(): Promise<boolean> {
  try {
    const response = await fetch("/.well-known/oauth-protected-resource/mcp", {
      credentials: "omit",
      redirect: "manual",
      cache: "no-store",
    });
    if (!response.ok) return false;
    const metadata = (await response.json()) as { resource?: string };
    return metadata.resource === `${window.location.origin}/mcp`;
  } catch {
    return false;
  }
}

export function McpSettings() {
  const status = useQuery({
    queryKey: ["mcp-public-oauth"],
    queryFn: checkPublicOAuth,
    staleTime: 0,
    refetchInterval: false,
  });
  const { origin, host } = window.location;

  return (
    <SettingsBlock
      id="mcp-settings-heading"
      title="AI agents (MCP)"
      description="Let MCP clients read conversations and send email after you approve them."
    >
      <SettingsPanel>
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <div>
            <p className="text-[13.5px] font-medium text-foreground">Server URL</p>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Add this URL to your MCP client. It will open an approval page here on first connect.
            </p>
          </div>
          <CopyField value={`${origin}/mcp`} />
        </div>

        <div className="border-t px-4 py-4 sm:px-5">
          {status.isLoading ? (
            <p className="text-[13px] text-muted-foreground">Checking OAuth endpoints…</p>
          ) : status.data ? (
            <p className="text-[13px] leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">Ready.</span> OAuth endpoints are
              public, and approval stays behind Cloudflare Access.
            </p>
          ) : (
            <div className="text-[13px] leading-6 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
              <p className="font-medium text-foreground">One more step: let MCP clients through Access</p>
              <p className="mt-1">
                Access currently blocks the OAuth endpoints MCP clients need. In{" "}
                <strong>Zero Trust → Access → Applications</strong>, add a{" "}
                <strong>Self-hosted</strong> application with these three destinations and a
                single <strong>Bypass</strong> policy for <strong>Everyone</strong>:
              </p>
              <div className="mt-3 space-y-2">
                <CopyField value={`${host}/mcp`} />
                <CopyField value={`${host}/oauth`} />
                <CopyField value={`${host}/.well-known`} />
              </div>
              <p className="mt-2">
                Everything else, including the <code className="font-mono text-[12px]">/authorize</code>{" "}
                approval page, stays protected. The MCP endpoint still requires an OAuth token.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => status.refetch()}
                disabled={status.isFetching}
              >
                {status.isFetching ? "Checking…" : "Check again"}
              </Button>
            </div>
          )}
        </div>
      </SettingsPanel>
    </SettingsBlock>
  );
}
