import {
  OAuthProvider,
  type OAuthHelpers,
  type TokenSummary,
} from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { WorkerEntrypoint } from "cloudflare:workers";
import { authorizationHandler, type AuthorizationEnv } from "./authorization.ts";
import { MCP_READ_SCOPE, MCP_SEND_SCOPE, type OAuthGrantProps } from "./auth-types.ts";
import {
  isRejectedMcpRouteLookalike,
  MCP_ROUTE,
} from "./route.ts";
import { createAgenticInboxServer, type McpEnv } from "./server.ts";

interface Env extends McpEnv, AuthorizationEnv {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  MCP_SEND_ENABLED?: string;
}

const MCP_ORIGIN = "https://mcp.lessbutbetter.studio";
const MCP_RESOURCE = `${MCP_ORIGIN}${MCP_ROUTE}`;

class McpApiHandler extends WorkerEntrypoint<Env, OAuthGrantProps> {
  async fetch(request: Request): Promise<Response> {
    const authorization = request.headers.get("Authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    const summary = token
      ? await this.env.OAUTH_PROVIDER.unwrapToken<OAuthGrantProps>(token)
      : null;
    if (!token || !summary) {
      return oauthError(401, "invalid_token", "Invalid access token");
    }
    if (!summary.scope.includes(MCP_READ_SCOPE)) {
      return oauthError(
        403,
        "insufficient_scope",
        `The ${MCP_READ_SCOPE} scope is required`,
        MCP_READ_SCOPE,
      );
    }

    const props = this.ctx.props;
    if (
      props.clientId !== summary.grant.clientId ||
      props.sub !== summary.userId ||
      !sameScopes(props.scopes, summary.scope)
    ) {
      return oauthError(401, "invalid_token", "Access token context is inconsistent");
    }

    const identity = {
      email: props.email,
      sub: props.sub,
      clientId: summary.grant.clientId,
      canSend:
        summary.scope.includes(MCP_SEND_SCOPE) &&
        this.env.MCP_SEND_ENABLED === "true",
    };
    const hostname = this.env.MCP_HOSTNAME ?? "mcp.lessbutbetter.studio";
    const handler = createMcpHandler(
      () => createAgenticInboxServer(this.env, identity),
      {
        route: MCP_ROUTE,
        allowedHostnames: [hostname],
        allowedOriginHostnames: [hostname],
        legacy: "stateless",
        responseMode: "auto",
        authContext: { props },
      },
    );
    const resource = tokenResource(summary);
    return handler.fetch(request, {
      authInfo: {
        token,
        clientId: summary.grant.clientId,
        scopes: summary.scope,
        expiresAt: summary.expiresAt,
        ...(resource ? { resource } : {}),
        extra: { props },
      },
    });
  }
}

function sameScopes(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((scope) => right.includes(scope));
}

function tokenResource(summary: TokenSummary<OAuthGrantProps>): URL | undefined {
  const audience = Array.isArray(summary.audience) ? summary.audience[0] : summary.audience;
  if (!audience) return undefined;
  try {
    return new URL(audience);
  } catch {
    return undefined;
  }
}

function oauthError(
  status: number,
  error: string,
  description: string,
  scope?: string,
): Response {
  const challenge = [
    'Bearer realm="Agentic Inbox"',
    `error="${error}"`,
    `error_description="${description}"`,
    `resource_metadata="${MCP_ORIGIN}/.well-known/oauth-protected-resource/v1"`,
    ...(scope ? [`scope="${scope}"`] : []),
  ].join(", ");
  return Response.json(
    { error, error_description: description },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": challenge,
      },
    },
  );
}

const oauthProvider = new OAuthProvider<Env>({
  apiRoute: MCP_ROUTE,
  apiHandler: McpApiHandler,
  defaultHandler: authorizationHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [MCP_READ_SCOPE, MCP_SEND_SCOPE],
  resourceMetadata: {
    resource: MCP_RESOURCE,
    authorization_servers: [MCP_ORIGIN],
    scopes_supported: [MCP_READ_SCOPE, MCP_SEND_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Agentic Inbox",
  },
  accessTokenTTL: 15 * 60,
  refreshTokenTTL: 30 * 24 * 60 * 60,
  clientRegistrationTTL: 90 * 24 * 60 * 60,
  allowPlainPKCE: false,
  allowImplicitFlow: false,
  tokenExchangeCallback(options) {
    return {
      accessTokenProps: {
        ...options.props,
        clientId: options.clientId,
        scopes: options.requestedScope,
      } satisfies OAuthGrantProps,
    };
  },
  onError({ status, code, internal }) {
    console.warn("MCP OAuth error", {
      status,
      code,
      internalCategory: internal?.category,
      internalReason: internal?.reason,
    });
  },
});

const worker: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    if (isRejectedMcpRouteLookalike(new URL(request.url).pathname)) {
      return new Response("Not found", { status: 404 });
    }
    return oauthProvider.fetch(request, env, ctx);
  },
};

export default worker;
