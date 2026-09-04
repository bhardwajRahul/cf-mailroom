import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
export interface AccessEnv {
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  MCP_ALLOWED_EMAILS: string;
}

export interface AccessIdentity {
  email: string;
  sub: string;
  expiresAt?: number;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyAccessRequest(
  request: Request,
  env: AccessEnv,
): Promise<AccessIdentity> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new AccessAuthError("Missing Cloudflare Access assertion", 401);
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) {
    throw new AccessAuthError("MCP OAuth is not configured", 503);
  }

  const issuer = env.TEAM_DOMAIN.replace(/\/$/, "");
  let jwks = keySets.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, jwks);
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: env.POLICY_AUD,
    }));
  } catch (error) {
    if (error instanceof TypeError) {
      throw new AccessAuthError("Cloudflare Access key service is unavailable", 503);
    }
    throw new AccessAuthError("Invalid or expired Cloudflare Access assertion", 401);
  }

  if (
    payload.type !== "app" ||
    typeof payload.email !== "string" ||
    !payload.email ||
    typeof payload.sub !== "string" ||
    !payload.sub
  ) {
    throw new AccessAuthError("Cloudflare Access user identity is incomplete", 403);
  }
  const allowedEmails = new Set(
    env.MCP_ALLOWED_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowedEmails.size === 0) {
    throw new AccessAuthError("MCP owner allowlist is not configured", 503);
  }
  if (!allowedEmails.has(payload.email.toLowerCase())) {
    throw new AccessAuthError("This Access identity is not allowed to use MCP", 403);
  }
  return {
    email: payload.email,
    sub: payload.sub,
    ...(payload.exp ? { expiresAt: payload.exp } : {}),
  };
}

export class AccessAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
