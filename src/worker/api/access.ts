import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";

export interface WebAccessEnv {
  WEB_ACCESS_TEAM_DOMAIN?: string;
  WEB_ACCESS_AUD?: string;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Verify Access's signed assertion, even if a public route misses edge protection. */
export const requireWebAccess: MiddlewareHandler<{ Bindings: WebAccessEnv }> = async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  const issuer = accessIssuer(c.env.WEB_ACCESS_TEAM_DOMAIN);
  const audience = c.env.WEB_ACCESS_AUD?.trim();
  if (!issuer || !audience) {
    return c.json({ error: "Web authentication is not configured" }, 503);
  }

  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) return c.json({ error: "Authentication required" }, 401);

  let jwks = keySets.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub", "email", "type"],
    });
    if (
      payload.type !== "app" ||
      typeof payload.sub !== "string" || !payload.sub.trim() ||
      typeof payload.email !== "string" || !payload.email.trim()
    ) {
      return c.json({ error: "An Access user identity is required" }, 403);
    }
  } catch (error) {
    if (error instanceof TypeError || error instanceof errors.JWKSTimeout ||
        (error instanceof errors.JOSEError && error.code === "ERR_JOSE_GENERIC")) {
      return c.json({ error: "Authentication service unavailable" }, 503);
    }
    return c.json({ error: "Invalid or expired Access assertion" }, 401);
  }
  await next();
};

function accessIssuer(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/"
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}
