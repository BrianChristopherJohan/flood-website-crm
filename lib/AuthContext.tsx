"use client";

// ─────────────────────────────────────────────────────────────
// AuthContext — Real JWT auth via Java Spring Boot API
//
// Was: localStorage mock (passwords stored in plaintext)
// Now: POST /auth/login → Java API → JWT access + refresh tokens
//      Tokens stored in localStorage (access) and httpOnly-style
//      via cookie (refresh handled server-side in Next.js API)
//
// Token refresh: on 401, auto-retried once with /auth/refresh
// ─────────────────────────────────────────────────────────────

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { normaliseJavaApiBase } from "@/lib/normaliseJavaApiBase";
import { roleFromJwtOrApiRole } from "@/lib/permissions";

// ── Types ─────────────────────────────────────────────────────

export type User = {
  id: string;
  name: string;           // firstName + " " + lastName
  email: string;
  phone?: string;
  department?: string;    // mapped from locationLabel
  role: string;           // 'admin' | 'operator' | 'viewer' etc.
  status: "active" | "inactive";
  avatarUrl?: string;
  twoFactorEnabled?: boolean;
  passwordLastChanged?: string;
  notifications?: boolean;
  emailAlerts?: boolean;
  smsAlerts?: boolean;
};

export type Session = {
  id: string;
  device: string;
  browser: string;
  location: string;
  lastActive: string;
  isCurrent: boolean;
};

type AuthContextType = {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessions: Session[];
  /**
   * True when AuthContext hydrated from `/api/auth/me` but the Java
   * backend was unreachable, so `displayName` + `avatarUrl` are missing.
   * AppShellWrapper surfaces a yellow "service starting" banner with a
   * retry button. (QA P0-7 — cold-start UX.)
   */
  isProfileSynthesized: boolean;
  /** Re-hydrate the profile by calling `/api/auth/me` again. */
  refreshProfile: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password: string, confirmPassword: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateUser: (userData: Partial<User>) => void;
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) => Promise<{ success: boolean; error?: string }>;
  toggleTwoFactor: () => Promise<{ success: boolean; enabled: boolean }>;
  terminateSession: (sessionId: string) => void;
  terminateAllOtherSessions: () => void;
  /** Silently exchange the refresh token for a new access token. Returns the new token or null on failure. */
  silentRefresh: () => Promise<string | null>;
};

// ── Java API base URL ─────────────────────────────────────────
// Server-side API routes proxy all Java calls — the browser never needs
// the Java URL directly. NEXT_PUBLIC_JAVA_API_URL is only kept as a
// fallback for legacy direct calls (login form in the CRM itself).

/** flood-service-crm listens on port 4002 locally (see application.yml PORT). */
const JAVA_API = normaliseJavaApiBase(
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_JAVA_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.JAVA_API_URL ||
        process.env.NEXT_PUBLIC_JAVA_API_URL ||
        process.env.NEXT_PUBLIC_API_BASE_URL,
  "http://localhost:4002",
);

// ── Token storage ─────────────────────────────────────────────

const TOKEN_KEY = "flood_access_token";
const REFRESH_KEY = "flood_refresh_token";
const USER_KEY = "flood_auth_user";

function storeTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

function clearStorage() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

// ── JWT helpers ───────────────────────────────────────────────

function parseJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Returns ms until token expires. Negative = already expired. */
function msUntilExpiry(token: string): number {
  const exp = parseJwtExp(token);
  if (exp === null) return -1;
  return exp * 1000 - Date.now();
}

// Refresh 2 minutes before expiry (access token is 15 min)
const REFRESH_AHEAD_MS = 2 * 60 * 1000;

// ── Java API helpers ──────────────────────────────────────────

type JavaUser = {
  id: string;
  displayName: string;
  email: string;
  role?: string;
  avatarUrl?: string;
};

type LoginResponse = {
  session: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
  user: JavaUser;
};

function toLocalUser(javaUser: JavaUser): User {
  return {
    id: javaUser.id,
    name: javaUser.displayName || javaUser.email,
    email: javaUser.email,
    role: roleFromJwtOrApiRole(javaUser.role ?? "CUSTOMER"),
    status: "active",
    avatarUrl: javaUser.avatarUrl ?? undefined,
    twoFactorEnabled: false,
    passwordLastChanged: new Date().toISOString(),
    notifications: true,
    emailAlerts: true,
    smsAlerts: false,
  };
}

/** Shared timeout for all direct Java API calls: 8 s for login/register, 5 s for refresh */
function makeSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function javaPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${JAVA_API}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: makeSignal(8_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function javaPatch<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${JAVA_API}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
    signal: makeSignal(8_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Session generator ─────────────────────────────────────────

function generateSessionInfo() {
  if (typeof window === "undefined") {
    return { device: "Unknown", browser: "Unknown", location: "Unknown" };
  }
  const ua = navigator.userAgent;
  let browser = "Unknown";
  let device = "Desktop";

  if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari")) browser = "Safari";
  else if (ua.includes("Edge")) browser = "Edge";

  if (ua.includes("Windows")) device = "Windows";
  else if (ua.includes("Mac")) device = "macOS";
  else if (ua.includes("Linux")) device = "Linux";
  else if (ua.includes("Android")) device = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) device = "iOS";

  return { device, browser, location: "Kuching, Sarawak" };
}

// ── Context ───────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileSynthesized, setIsProfileSynthesized] = useState(false);
  const router = useRouter();
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Schedule proactive refresh ──────────────────────────────
  const scheduleRefresh = useCallback((token: string, onRefresh: () => void) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const delay = msUntilExpiry(token) - REFRESH_AHEAD_MS;
    if (delay > 0) {
      refreshTimerRef.current = setTimeout(onRefresh, delay);
    }
  }, []);

  // ── Silent token refresh ────────────────────────────────────
  //
  // QA NEW-3 — refresh failures now distinguish "token genuinely
  // revoked" from "Java temporarily unreachable":
  //
  //   • 401 / 403           → token rejected by Java. Logout + redirect.
  //   • 5xx / network / abort → transient. Retry with exponential
  //                           backoff (1s, 2s, 4s, 8s — total ≤ 15s),
  //                           THEN logout only if all retries fail.
  //                           Stops a 4-second Railway cold-start
  //                           during a scheduled refresh from kicking
  //                           the user out of a long-running session.
  //
  // The retry stays inside `silentRefresh` so the caller (proactive
  // schedule OR an authFetch 401-retry path) doesn't need to know
  // the difference.
  const silentRefresh = useCallback(async (): Promise<string | null> => {
    const storedRefresh = localStorage.getItem(REFRESH_KEY);
    if (!storedRefresh) return null;

    const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
    let lastFailureWasTerminal = false;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: storedRefresh }),
          // Tight per-attempt timeout; the retry loop is the
          // budget mechanism.
          signal: makeSignal(6_000),
        });
        if (res.ok) {
          const data: { accessToken: string } = await res.json();
          localStorage.setItem(TOKEN_KEY, data.accessToken);
          setAccessToken(data.accessToken);
          return data.accessToken;
        }
        // 4xx — Java rejected the refresh. Token is dead; no
        // point retrying. Break out and logout below.
        if (res.status >= 400 && res.status < 500) {
          lastFailureWasTerminal = true;
          break;
        }
        // 5xx — Java is up but unhappy (cold start, DB blip).
        // Fall through to the backoff delay.
      } catch {
        // AbortError / network error / DNS — treat as transient.
      }
      // Backoff before the next attempt, if any remain.
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }

    // All retries exhausted, or Java terminally rejected the token.
    if (lastFailureWasTerminal) {
      console.warn("[AuthContext] refresh rejected by Java — logging out");
    } else {
      console.warn(
        "[AuthContext] refresh failed after retries — logging out (Java unreachable)",
      );
    }
    clearStorage();
    setUser(null);
    setAccessToken(null);
    router.push("/login");
    return null;
  }, [router]);

  // ── Load persisted session on mount ────────────────────────
  //
  // Hydration is now cookie-first:
  //
  //   1. Ask /api/auth/me — reads the httpOnly access cookie,
  //      re-validates the role server-side, returns the user.
  //   2. If that 401s but the legacy localStorage keys are present,
  //      fall back to the old path so in-flight sessions minted
  //      before the cookie cut-over keep working.
  //   3. If both fail, leave user=null. AppShellWrapper will route
  //      to /login on the next render.
  //
  // The `accessToken` state is unused on the cookie path — every
  // authenticated server call goes through a same-origin BFF route
  // that reads the cookie. It's still set on the localStorage
  // fallback so legacy components that read it keep working.
  useEffect(() => {
    const init = async () => {
      try {
        // ── 1. Cookie path: /api/auth/me ─────────────────────────
        try {
          const meRes = await fetch("/api/auth/me", {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });
          if (meRes.ok) {
            const data = (await meRes.json()) as {
              user: {
                id: string;
                email: string;
                displayName: string;
                avatarUrl: string | null;
                role: string;
                roleLabel: string;
              };
              synthesized?: boolean;
            };
            // QA P0-7: surface cold-start state so AppShellWrapper
            // can render a "service starting" banner with a retry
            // button instead of a half-rendered shell.
            setIsProfileSynthesized(data.synthesized === true);
            const localUser: User = {
              id: data.user.id,
              name: data.user.displayName || data.user.email,
              email: data.user.email,
              role: roleFromJwtOrApiRole(data.user.roleLabel || data.user.role),
              status: "active",
              avatarUrl: data.user.avatarUrl ?? undefined,
              twoFactorEnabled: false,
              passwordLastChanged: new Date().toISOString(),
              notifications: true,
              emailAlerts: true,
              smsAlerts: false,
            };
            setUser(localUser);
            // Pull the legacy sessions list if it survives — non-fatal
            // if missing; the UI just shows an empty Sessions tab.
            try {
              const stored = localStorage.getItem(`flood_sessions_${localUser.id}`);
              if (stored) setSessions(JSON.parse(stored));
            } catch {
              /* ignore */
            }
            return;
          }
        } catch {
          // Network failure (CRM Vercel down / Redis blip) — fall
          // through to the legacy path so a user with localStorage
          // tokens can still load the app while the cookie path is
          // unavailable.
        }

        // ── 2. Legacy localStorage path (transitional) ───────────
        const storedToken = localStorage.getItem(TOKEN_KEY);
        const storedUser = localStorage.getItem(USER_KEY);
        if (!storedToken || !storedUser
            || storedToken === "undefined" || storedToken === "null"
            || storedUser === "undefined"  || storedUser === "null") {
          clearStorage();
          return;
        }

        let activeToken = storedToken;
        if (msUntilExpiry(storedToken) <= REFRESH_AHEAD_MS) {
          const refreshed = await silentRefresh();
          if (!refreshed) return;
          activeToken = refreshed;
        }

        setAccessToken(activeToken);
        setUser(JSON.parse(storedUser));
        scheduleRefresh(activeToken, () => silentRefresh());

        const uid = (JSON.parse(storedUser) as User).id;
        const stored = localStorage.getItem(`flood_sessions_${uid}`);
        if (stored) setSessions(JSON.parse(stored));
      } catch {
        clearStorage();
      } finally {
        setIsLoading(false);
      }
    };
    init();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const data = await javaPost<LoginResponse>("/auth/login", { email, password });

      storeTokens(data.session.accessToken, data.session.refreshToken);
      const localUser = toLocalUser(data.user);
      localStorage.setItem(USER_KEY, JSON.stringify(localUser));

      // Create a local session record for the sessions panel
      const sessionInfo = generateSessionInfo();
      const newSession: Session = {
        id: `session-${Date.now()}`,
        ...sessionInfo,
        lastActive: new Date().toISOString(),
        isCurrent: true,
      };
      const existing = localStorage.getItem(`flood_sessions_${localUser.id}`);
      let userSessions: Session[] = existing ? JSON.parse(existing) : [];
      userSessions = userSessions.map((s) => ({ ...s, isCurrent: false }));
      userSessions.unshift(newSession);
      if (userSessions.length > 10) userSessions = userSessions.slice(0, 10);
      localStorage.setItem(`flood_sessions_${localUser.id}`, JSON.stringify(userSessions));

      setAccessToken(data.session.accessToken);
      setUser(localUser);
      setSessions(userSessions);

      // Schedule auto-refresh before token expires
      scheduleRefresh(data.session.accessToken, () => silentRefresh());

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Login failed",
      };
    }
  }, [scheduleRefresh, silentRefresh]);

  const register = useCallback(async (
    name: string,
    email: string,
    password: string,
    confirmPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!name.trim()) return { success: false, error: "Name is required" };
    if (!email.includes("@")) return { success: false, error: "Valid email required" };
    if (password.length < 8) return { success: false, error: "Password must be at least 8 characters" };
    if (password !== confirmPassword) return { success: false, error: "Passwords do not match" };

    try {
      const nameParts = name.trim().split(" ");
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ") || firstName;

      const data = await javaPost<LoginResponse>("/auth/register", {
        firstName,
        lastName,
        email,
        password,
      });

      storeTokens(data.session.accessToken, data.session.refreshToken);
      const localUser = toLocalUser(data.user);
      localStorage.setItem(USER_KEY, JSON.stringify(localUser));

      setAccessToken(data.session.accessToken);
      setUser(localUser);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Registration failed",
      };
    }
  }, []);

  const logout = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    if (user) {
      const stored = localStorage.getItem(`flood_sessions_${user.id}`);
      if (stored) {
        const updated = (JSON.parse(stored) as Session[]).filter((s) => !s.isCurrent);
        localStorage.setItem(`flood_sessions_${user.id}`, JSON.stringify(updated));
      }
    }
    clearStorage();
    setUser(null);
    setAccessToken(null);
    setSessions([]);
    // Best-effort: ask the server to clear the httpOnly auth cookies
    // and revoke the refresh token on the Java side. Fire-and-forget;
    // even if it errors, the client-side state is already wiped and
    // the redirect below sends the user to /login.
    if (typeof window !== "undefined") {
      void fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      }).catch(() => { /* swallow — local wipe is what matters */ });
    }
    router.push("/login");
  }, [user, router]);

  const updateUser = useCallback((userData: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return null;
      const updated = { ...prev, ...userData };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      // Sync to Java API (fire-and-forget)
      if (accessToken) {
        const { name, phone, department } = updated;
        const nameParts = name.split(" ");
        javaPatch("/profile", {
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(" ") || nameParts[0],
          phone,
          locationLabel: department,
        }, accessToken).catch(console.error);
      }
      return updated;
    });
  }, [accessToken]);

  // QA P0-7: lets AppShellWrapper "Retry" button re-hit /api/auth/me
  // and clear the cold-start banner once Java is warm.
  const refreshProfile = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        user: {
          id: string;
          email: string;
          displayName: string;
          avatarUrl: string | null;
          role: string;
          roleLabel: string;
        };
        synthesized?: boolean;
      };
      setIsProfileSynthesized(data.synthesized === true);
      setUser((prev) =>
        prev
          ? {
              ...prev,
              name: data.user.displayName || data.user.email,
              email: data.user.email,
              avatarUrl: data.user.avatarUrl ?? undefined,
              role: roleFromJwtOrApiRole(data.user.roleLabel || data.user.role),
            }
          : prev,
      );
    } catch {
      // Network blip — leave the synthesised banner as-is; user can retry.
    }
  }, []);

  const changePassword = useCallback(async (
    currentPassword: string,
    newPassword: string,
    confirmPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: "Not authenticated" };
    if (newPassword.length < 8) return { success: false, error: "New password must be at least 8 characters" };
    if (newPassword !== confirmPassword) return { success: false, error: "Passwords do not match" };
    if (newPassword === currentPassword) return { success: false, error: "New password must differ from current" };

    try {
      await javaPost("/auth/change-password", {
        currentPassword,
        newPassword,
      }, accessToken ?? undefined);

      setUser((prev) =>
        prev ? { ...prev, passwordLastChanged: new Date().toISOString() } : null
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Password change failed",
      };
    }
  }, [user, accessToken]);

  // TODO: UI-only until TOTP backend is implemented — currently just toggles the local flag
  const toggleTwoFactor = useCallback(async (): Promise<{ success: boolean; enabled: boolean }> => {
    if (!user) return { success: false, enabled: false };
    const newValue = !user.twoFactorEnabled;
    updateUser({ twoFactorEnabled: newValue });
    return { success: true, enabled: newValue };
  }, [user, updateUser]);

  const terminateSession = useCallback((sessionId: string) => {
    if (!user) return;
    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    localStorage.setItem(`flood_sessions_${user.id}`, JSON.stringify(updated));
  }, [user, sessions]);

  const terminateAllOtherSessions = useCallback(() => {
    if (!user) return;
    const current = sessions.filter((s) => s.isCurrent);
    setSessions(current);
    localStorage.setItem(`flood_sessions_${user.id}`, JSON.stringify(current));
  }, [user, sessions]);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isAuthenticated: !!user,
        isLoading,
        sessions,
        isProfileSynthesized,
        refreshProfile,
        login,
        register,
        logout,
        updateUser,
        changePassword,
        toggleTwoFactor,
        terminateSession,
        terminateAllOtherSessions,
        silentRefresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
