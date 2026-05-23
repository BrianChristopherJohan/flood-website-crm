# flood-website-crm

![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38bdf8?logo=tailwind-css)
![License](https://img.shields.io/badge/license-MIT-green)

**CRM dashboard for FloodWatch — the real-time flood monitoring system for Sarawak, Malaysia.**

## Overview

`flood-website-crm` is a Next.js 14 web application used by **operations managers and administrators** to monitor the FloodWatch sensor network. It provides a live sensor map, flood risk analytics driven by the AI prediction microservice, community moderation tools, broadcast management, and full system administration — all in one secure, role-gated dashboard.

The frontend proxies all data through Next.js API routes to `flood-service-crm` (port 4002) and `flood-ai-prediction` (port 8000), keeping backend URLs and secrets server-side.

## Features

- **Real-time sensor map** — interactive Google Maps view of all sensor nodes with live status indicators and favourites management
- **Flood Risk Analysis** — Hourly / Daily / Weekly / Monthly charts (powered by Recharts) with XGBoost-sourced risk level filtering (0 = Low → 3 = Extreme)
- **Analytics dashboard** — system-wide KPIs, alert counts, node health overview, and historical trend charts
- **Community management** — view, moderate, and delete community posts and groups
- **User management** — create, edit, deactivate, and manage admin / operations-manager accounts
- **Broadcasts** — compose and send flood alerts to all registered community users
- **CRM Settings** — configure sensor refresh intervals, data retention policies, and system parameters
- **Dark / Light theme** — full Tailwind dark-mode support, togglable per session
- **JWT authentication** — access token (15 min) + refresh token (7 days) with role-based route guards (`ROLE_ADMIN`, `ROLE_OPERATIONS_MANAGER`)
- **Toast notifications** — real-time action feedback via React Hot Toast

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| Next.js | 14 (App Router) | React framework & API proxy |
| TypeScript | 5 | Static typing |
| Tailwind CSS | 3 | Utility-first styling |
| Recharts | 2 | Data visualisation charts |
| `@react-google-maps/api` | 2 | Google Maps integration |
| React Hot Toast | 2 | Notification toasts |
| Node.js | ≥ 18 | Runtime |

## Architecture

```
flood-website-crm  (:3002 local dev)
        │  Next.js API routes (server-side proxy)
        ├──────────────────────► flood-service-crm  (:4002)
        │                           Spring Boot 3 / PostgreSQL / Redis
        │
        └──────────────────────► flood-ai-prediction (:8000)
                                    FastAPI / XGBoost
```

The browser never contacts the backend services directly. All requests flow through `/app/api/**` route handlers, which attach server-side secrets and forward to the appropriate upstream.

## Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x (or pnpm / yarn)
- `flood-service-crm` running on port 4002
- `flood-ai-prediction` running on port 8000 (optional — Risk Analysis page degrades gracefully)
- A Google Maps API key (for the sensor map)

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/your-org/floodwatch.git
cd floodwatch/flood-website-crm
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in the required values (see [Environment Variables](#environment-variables) below).

For a localhost-first setup, use the local fallback template instead:

```bash
cp .env.local.example .env.local
```

That template sets `CRM_LOCAL_LOGIN=true`, so
`http://localhost:3002/login?error=expired` renders a CRM-local login form.
The CRM dev server now uses port `3002` by default; `localhost:3000` is not
used for this app. If you want to test the production SSO-style flow locally,
set `CRM_LOCAL_LOGIN=false` and run the community website on `localhost:3003`.

### 3. Start the development server

```bash
npm run dev
```

The app is available at [http://localhost:3002](http://localhost:3002).

### 4. Production build

```bash
npm run build
npm start
```

## Environment Variables

Copy `.env.example` to `.env.local` and set the following:

| Variable | Description | Example |
|---|---|---|
| `JAVA_API_URL` | Server-side URL for `flood-service-crm` (used by API routes) | `http://localhost:4002` |
| `NEXT_PUBLIC_JAVA_API_URL` | Browser-side URL for direct auth calls | `http://localhost:4002` |
| `COMMUNITY_JAVA_API_URL` | Server-side URL for community-only admin/UAT routes | `http://localhost:4001` |
| `NEXT_PUBLIC_COMMUNITY_URL` | URL of the public community portal | `http://localhost:3003` |
| `AI_API_URL` | Server-side URL for `flood-ai-prediction`; used by `/api/ai-predict*` | `http://localhost:8000` |
| `FLOODWATCH_API_BASE` | Server-side FloodWatch IoT API base URL | `http://159.223.70.28/api/v1` |
| `FLOODWATCH_DATASET` | Default IoT dataset (`real`, `sample`, or `all`) | `sample` |
| `CRM_LOCAL_LOGIN` | Local-only CRM login form; leave unset/false on Vercel | `true` |
| `ALLOW_PAYLOAD_ONLY_AUTH` | Local-only middleware fallback when `JWT_SECRET` is not available | `true` |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Google Maps JavaScript API key | `AIzaSy...` |

> **Note:** Never commit `.env.local` to version control.

### Vercel deployment

Set the same variables in Vercel Project Settings -> Environment Variables. Recommended production values:

| Variable | Vercel value |
|---|---|
| `JAVA_API_URL` | `https://flood-service-crm-production.up.railway.app` |
| `COMMUNITY_JAVA_API_URL` | `https://flood-service-community-production.up.railway.app` |
| `NEXT_PUBLIC_COMMUNITY_URL` | Your deployed community website URL |
| `AI_API_URL` | `https://flood-ai-prediction-production.up.railway.app` |
| `FLOODWATCH_API_BASE` | `http://159.223.70.28/api/v1` |
| `FLOODWATCH_DATASET` | `real` for production, `sample` for demos |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | A browser key restricted to your Vercel domains |
| `JWT_SECRET` | Same value as the CRM backend JWT secret, if edge verification is enabled |

## API Endpoints (Next.js proxy routes)

These are the internal Next.js API routes that proxy to `flood-service-crm` and `flood-ai-prediction`.

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/api/auth/login` | Authenticate and receive JWT tokens | Public |
| `POST` | `/api/auth/register` | Register a new CRM user | Public |
| `POST` | `/api/auth/forgot-password` | Send password-reset code | Public |
| `POST` | `/api/auth/verify-reset-code` | Verify reset code | Public |
| `POST` | `/api/auth/change-password` | Change authenticated user's password | JWT |
| `GET` | `/api/nodes` | List all sensor nodes | JWT |
| `GET/POST` | `/api/analytics` | Fetch aggregated analytics data | JWT |
| `GET/POST/DELETE` | `/api/community/posts` | Community post management | JWT |
| `GET/POST/DELETE` | `/api/community/groups` | Community group management | JWT |
| `GET/POST/DELETE` | `/api/blogs` | Blog post management | JWT |
| `POST` | `/api/blogs/[id]/featured` | Toggle blog featured status | JWT |
| `GET/POST` | `/api/broadcasts` | Broadcast alerts | JWT |
| `GET/PUT/DELETE` | `/api/admin/users` | Admin user management | JWT (ADMIN) |
| `GET/PUT/DELETE` | `/api/reports/[id]` | Flood report management | JWT |
| `PUT` | `/api/reports/[id]/status` | Update report status | JWT |
| `GET` | `/api/zones` | Flood zone data | JWT |
| `GET` | `/api/health` | Service health check | Public |
| `POST` | `/api/ai-predict` | Flood risk prediction (proxied to port 8000) | JWT |

## Project Structure

```
flood-website-crm/
├── app/
│   ├── api/                 # Next.js API route handlers (server-side proxy)
│   │   ├── auth/            # Login, register, password reset
│   │   ├── nodes/           # Sensor node endpoints
│   │   ├── analytics/       # Analytics aggregation
│   │   ├── community/       # Posts & groups
│   │   ├── blogs/           # Blog management
│   │   ├── broadcasts/      # Broadcast alerts
│   │   ├── admin/           # Admin user management
│   │   ├── reports/         # Flood reports
│   │   ├── zones/           # Zone data
│   │   ├── ai-predict/      # AI prediction proxy
│   │   └── health/          # Health check
│   ├── dashboard/           # Main dashboard page
│   ├── map/                 # Sensor map page
│   ├── analytics/           # Analytics & risk charts
│   ├── alerts/              # Alerts management
│   ├── community/           # Community moderation
│   ├── blog/                # Blog management
│   ├── broadcasts/          # Broadcast management
│   ├── reports/             # Reports management
│   ├── sensors/             # Sensor node management
│   ├── settings/            # CRM settings
│   ├── admin/               # Admin user management
│   ├── roles/               # Role management
│   ├── portal/              # Portal overview
│   ├── login/               # Auth pages
│   ├── layout.tsx           # Root layout (theme, auth context)
│   └── globals.css          # Global styles
├── components/              # Reusable UI components
├── lib/                     # API client, auth helpers, utilities
├── types/                   # TypeScript type definitions
├── public/                  # Static assets
├── .env.example             # Environment variable template
├── .env.local               # Local secrets (git-ignored)
├── next.config.ts           # Next.js configuration
├── tailwind.config.*        # Tailwind CSS configuration
├── Dockerfile               # Production container
└── package.json
```

## Docker

The service is included in the project-wide `deploy/docker-compose.yml`. To run it in isolation:

```bash
# Build the image
docker build -t floodwatch-crm .

# Run with environment variables
docker run -p 3002:3000 \
  -e JAVA_API_URL=http://host.docker.internal:4002 \
  -e NEXT_PUBLIC_JAVA_API_URL=http://localhost:4002 \
  -e NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_key_here \
  floodwatch-crm
```

To run the full stack (recommended):

```bash
cd ../deploy
cp .env.example .env
# Edit .env with real values
docker compose up -d
```

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Create optimised production build |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |

## Contributing

1. Fork the repository and create a feature branch: `git checkout -b feat/your-feature`
2. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/)
3. Push and open a Pull Request against `main`
4. Ensure all lint checks pass before requesting review

## License

This project is licensed under the [MIT License](../LICENSE).

---

Part of the **FloodWatch** flood monitoring system for Sarawak, Malaysia.
