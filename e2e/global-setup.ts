import { request } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Global setup — runs once before all tests.
 *
 * Logs in via the CRM Java backend and seeds Playwright's storage state
 * with the same cookies + localStorage the real app produces after a
 * successful sign-in. Two pieces matter:
 *
 *   1. httpOnly cookies `flood_crm_access` + `flood_crm_refresh` — the
 *      Edge middleware reads these to gate every protected route. If
 *      they're missing the request is redirected to /login before the
 *      page payload ever ships.
 *
 *   2. localStorage entries (`flood_access_token`, `flood_refresh_token`,
 *      `flood_auth_user`) — the client AuthContext mirrors the cookie
 *      values here so React components can show the user's name, role
 *      and decide what to render without another round-trip.
 *
 * Env overrides for running against a non-default backend / admin:
 *   E2E_JAVA_API       (default http://localhost:4002)
 *   E2E_ADMIN_EMAIL    (default admin@example.com)
 *   E2E_ADMIN_PASSWORD (default Admin@123)
 */

const JAVA_API = process.env.E2E_JAVA_API ?? 'http://localhost:4002';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123';

/** Extract `exp` (seconds since epoch) from a JWT payload, with a 1h fallback. */
function jwtExpSeconds(token: string): number {
  try {
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    if (typeof payload.exp === 'number' && payload.exp > 0) return payload.exp;
  } catch {
    /* ignore — fall through to default */
  }
  return Math.floor(Date.now() / 1000) + 3600;
}

async function globalSetup() {
  const ctx = await request.newContext();

  const res = await ctx.post(`${JAVA_API}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok()) {
    throw new Error(
      `Global setup login failed: ${res.status()} ${await res.text()}`,
    );
  }

  const data = await res.json();
  // Java API returns { session: { accessToken, refreshToken }, user: { ... } }
  const session = data.session ?? data;
  const u = data.user ?? data;

  const rawRole = u.role ?? 'admin';
  const capitalizedRole = rawRole.charAt(0).toUpperCase() + rawRole.slice(1);

  const user = {
    id: u.id ?? '',
    name: u.displayName ?? u.email ?? ADMIN_EMAIL,
    email: u.email ?? ADMIN_EMAIL,
    role: capitalizedRole, // e.g. "Admin" — matches rolePermissions key
    status: 'active',
  };

  const accessExp = jwtExpSeconds(session.accessToken);
  const refreshExp = jwtExpSeconds(session.refreshToken);

  const storageState = {
    cookies: [
      {
        name: 'flood_crm_access',
        value: session.accessToken,
        domain: 'localhost',
        path: '/',
        expires: accessExp,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
      {
        name: 'flood_crm_refresh',
        value: session.refreshToken,
        domain: 'localhost',
        path: '/',
        expires: refreshExp,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [
      {
        origin: 'http://localhost:3000',
        localStorage: [
          { name: 'flood_access_token', value: session.accessToken },
          { name: 'flood_refresh_token', value: session.refreshToken },
          { name: 'flood_auth_user', value: JSON.stringify(user) },
        ],
      },
    ],
  };

  const stateFile = path.resolve(__dirname, '.auth-state.json');
  fs.writeFileSync(stateFile, JSON.stringify(storageState, null, 2));
  console.log(`\n✓ Auth state saved → ${stateFile}`);

  await ctx.dispose();
}

export default globalSetup;
