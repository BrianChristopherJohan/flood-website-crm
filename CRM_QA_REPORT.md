# FloodWatch CRM — QA Verification Report

**Date:** 2026-05-24 · **Engineer:** QA (headless browser + network interception)
**Build:** `flood-website-crm` (Next.js 16) against a **local Docker staging backend**
(`flood-service-crm`, `flood-service-community`, Postgres 16, Redis 7, **Kong 3.9 gateway**) — **never production.**

## 1. Methodology & environment

- **Stack:** `docker compose up postgres redis community-api crm-api kong-gateway` — all **healthy**. The CRM points at the backend **through Kong** (`JAVA_API_URL=http://localhost:8080/crm`, `COMMUNITY_JAVA_API_URL=http://localhost:8080/community`). Kong routing validated: `kong→/crm/actuator/health` and `kong→/community/actuator/health` both **200**.
  - *Fix applied during QA:* the committed compose pinned `kong:3.6-alpine`, which **no longer exists on Docker Hub** → changed to **`kong:3.9`** (verified the tag resolves; gateway boots + routes).
- **CRM app:** dev server on `:3000`, env repointed to local Kong (matching `JWT_SECRET`); real `.env.local` backed up to `.env.local.qabak`. **Confirmed not pointed at `*.up.railway.app`.**
- **Auth:** real operator JWTs issued by `crm-api /auth/login` (HS512, local `JWT_SECRET`), injected as the `flood_crm_access` cookie + `localStorage`. Admin bootstrapped via `ADMIN_SEED_*`; Viewer + Customer users inserted directly (the create-user API is broken — Defect 1).
- **Tools:** Claude Preview headless browser (navigate/eval/network/screenshot) + `curl` against the BFF/Kong. No automation code written.
- **Roles:** Admin (full), Viewer (read-only mid role), Customer (must be blocked).

## 2. Access-control matrix — ✅ PASS (verified in-browser)

| Check | Result |
|---|---|
| **Admin** sidebar | All **12** nav items ✅ |
| **Viewer** sidebar | Reduced to **7** (Dashboard, Sensors, Flood Map, Analytics, Alerts, Submit feedback, Account Settings); Community / News & Blog / Survey Responses / Role Management / CRM Settings **correctly hidden** ✅ |
| **Viewer** → direct URL `/roles` | "Not authorized…" guard, **no user table** ✅ (client-side `canAccessPage`) |
| **Customer** → `/dashboard` | Redirected to **`/login?error=role`** ✅ (edge middleware operator gate) |
| Unauthenticated → `/dashboard` | 307 → `/login` ✅ |

The 3-layer gate (edge middleware → page guard → reduced sidebar) all function as specified.

## 3. Global chrome — ✅ PASS (Admin)

TopBar present · profile shows name + role badge · **notification bell** polls `/api/notifications/unread-count` + `/api/notifications` (badge incremented 4→9 as **live IoT alerts merged in**) · **Ctrl+K** opens search dialog · theme control present (`html.dark`) · `IoTEventProvider` SSE `/api/sse/iot-events` connected (200).

## 4. Per-page results

| Page | Result | Evidence |
|---|---|---|
| **Dashboard** `/dashboard` | ✅ PASS | KPIs from live IoT (22 nodes, 12 critical/8 warning, riskiest SOS-D2, avg 2.4ft); `/api/iot/zones` 200 polling, `/api/ai-predict` 200, `/api/analytics` 200, SSE 200; Google Maps mini-map loaded; scale/chart/AI/min-level controls render. |
| **Sensors** `/sensors` | ✅ PASS | 22-row table; stats (21 online/1 offline, 7 critical); Export; status + online/offline filters; sortable. Viewer: Export permission-gated. |
| **Flood Map** `/map` | ✅ PASS (controls/data) | Filters (State/City/status chips), "22 of 22 nodes", legend, Saved Places; `/api/iot/nodes` 200; Maps API loaded. ⚠ canvas didn't mount in the headless probe window (timing; dashboard mini-map rendered). |
| **Analytics** `/analytics` | ✅ PASS | `GET /api/analytics` **200** (`stats`, charts). *(The 401 seen in the first run was a test-harness token/rate-limit artifact — see Resolved.)* |
| **Community** `/community` | ✅ PASS (structure) | 4 tabs + sort; `/api/community/posts` & `/groups` 200. |
| **News & Blog** `/blog` | ✅ PASS + **CRUD** | List, category tabs, "New Article", empty state; **full CRUD round-trip below**. |
| **Broadcasts** `/broadcasts` | ✅ PASS (create) | Admin-only gating; **broadcast send round-trip below**; `/api/zones` (target zones) 200. |
| **Reports** `/reports` | ✅ PASS (read) | `GET /api/reports` **200**. |
| **Role Management** `/roles` | ◐ read OK / **create broken** | `GET /api/admin/users` 200; **create user → 500 (Defect 1)**. |
| **Account Settings** `/admin` | n/a | Presentational only (no API). |
| **CRM Settings** `/settings` | n/a | `localStorage(crmSettings)` + connection test (client-side). |
| **Submit Feedback** `/feedback` | ✅ access | In sidebar for all operators (`alwaysShow`). |
| **Survey Responses** `/admin/feedback` | ◐ Admin-only access OK | In Admin sidebar, hidden for Viewer ✅; `GET /api/admin/surveys/uat` 401 — community-service route, admin user not present in `flood_community` (env gap, see Resolved 3). |
| **Portal** `/portal` | ✅ | Read-only community feed. |
| **Diagnostics** | ✅ | `/api/health` 200; renamed **`/api/health/redis`** responds; old `/api/health/upstash` → **404**. |

## 4a. CRUD round-trips — ✅ PASS (real, against staging)

| Flow | Result |
|---|---|
| **Blog create** `POST /api/blogs` | **201** (returns blog id) |
| **Blog appears in list** `GET /api/blogs` | 1 row ("QA Test Article") ✅ |
| **Blog feature** `PATCH /api/blogs/{id}/featured` | **200** ✅ |
| **Blog delete** `DELETE /api/blogs/{id}` | **204** → list back to 0 ✅ |
| **Broadcast send** `POST /api/broadcasts` | **201** (records `sentBy`=admin) → appears in `GET /api/broadcasts` ✅ |

## 5. Defects, resolved items & observations

**DEFECT 1 — Create user fails (500) — ✅ ROOT-CAUSED & FIXED.** `POST /admin/users` returned Postgres `null value in column "id" of relation "user_settings" violates not-null constraint`.
- **Root cause:** `UserSettingRepository.upsertDefault(...)` is a **native** INSERT (`INSERT INTO user_settings (user_id, key, enabled) …`) that **omits `id`**. The entity's `@UuidGenerator` only fires for JPA entity persists, **not native queries**, so `id` inserts NULL. `user_settings` is Hibernate-managed (no migration creates it with a DB-level `id` default, unlike the other tables), so this fails on any `ddl-auto` schema — i.e. **production is likely affected too** for the admin "Add User" feature (SSO-registered users take a different path).
- **Fix applied:** `flood-service-crm/src/main/java/.../repository/UserSettingRepository.java` — the INSERT now supplies the id: `INSERT INTO user_settings (id, user_id, key, enabled) VALUES (gen_random_uuid(), :userId, :key, false) …` (`gen_random_uuid()` is core in PostgreSQL 13+; works on every schema).
- **Verified:** rebuilt `crm-api`, `POST /admin/users` → **200**, new user created with **4 `user_settings` rows, 0 null ids**. ✅

**RESOLVED 2 — `/api/analytics` 401 was NOT a product bug.** With a valid (non-rate-limited) token, `/api/analytics` returns **200**. The first-run 401 was caused by the **login rate-limiter** (`429 retryAfterSeconds≈1112`) tripping under heavy repeated test logins → the batch used an empty/expired token.

**RESOLVED 3 — earlier CRM-data 401 cascade.** Same cause (rate-limited login). With one valid token, `admin/users`, `zones`, `reports`, `analytics`, `blogs`, `broadcasts`, `community/posts`, `community/groups`, `notifications/unread-count` all return **200**. The three that still 401 (`/api/admin/surveys/uat`, `/api/notifications` list, `/api/community/content-reports`) are **community-service-backed** and reject because the admin user exists only in `flood_crm`, not the (empty) `flood_community` DB — a **local split-DB seeding gap**, not a product defect (in prod the operator is known to both services).

**OBS 4 — Flood Map canvas** didn't mount inside the headless probe window (Maps JS loads; dashboard mini-map rendered). Controls + data verified.

**OBS 5 — Theme toggle** present; a single programmatic click opens its selector rather than instantly flipping `html.dark` (cosmetic).

**FIX applied — Kong image** `kong:3.6-alpine` → `kong:3.9` in `deploy/docker-compose.yml` (old tag missing from Docker Hub). Gateway now boots and routes correctly.

## 6. Summary

- **Access control (Admin/Viewer/Customer): PASS.** Global chrome, live IoT + SSE, IoT pages (Dashboard/Sensors/Map), Community/Blog structure: **PASS.**
- **CRUD round-trips (blog create→feature→delete, broadcast send): PASS** against the staging backend through Kong.
- **Analytics + the CRM-data routes work** with a valid token (the first-run 401s were login rate-limiting, now resolved).
- **One real defect found AND fixed:** the **create-user 500** (`user_settings.id`) — root-caused to a native INSERT omitting `id`; patched `UserSettingRepository.upsertDefault` to generate the id, rebuilt, and verified (`POST /admin/users` → 200, settings rows created with valid UUIDs).
- **Env-only notes:** community-backed CRM routes need the operator seeded into `flood_community` too; the Kong image tag was fixed.

### Teardown
`cd deploy && docker compose down -v`; restore `flood-website-crm/.env.local` from `.env.local.qabak`; remove `deploy/.env`.
