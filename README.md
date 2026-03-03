# Verdent Vision

Enterprise-style agriculture operations app with a React frontend and a secured Node API backend.

## Architecture

- `src/`: React + Vite frontend
- `server/`: Node API (no framework dependency) with:
  - cookie-based sessions (`HttpOnly`)
  - CSRF protection (`X-CSRF-Token`)
  - auth controls (PBKDF2 password hashing, login throttling, reset tokens, session revocation)
  - rate limiting (general/auth/LLM buckets)
  - strict security headers and CORS allowlist
  - JSON file database with atomic writes (`server/data/db.json`)
  - secure upload endpoint + protected `/uploads/*` access

## Quick Start

1. Copy `.env.example` to `.env` and fill the values.
2. Start the API:

```bash
npm run api
```

3. Start the frontend:

```bash
npm run dev
```

Default local URLs:
- Frontend: `http://localhost:5173`
- API: `http://127.0.0.1:5000/api/v1`

Vite proxies `/api` and `/uploads` to the API server by default.

## Security Notes

- For production, terminate TLS at a reverse proxy and set:
  - `FORCE_HTTPS=true`
  - `SESSION_COOKIE_SECURE=true`
  - strict `CORS_ORIGINS`
- `ADMIN_BOOTSTRAP_PASSWORD` is optional and only used if the seeded admin account has no password yet.
- Social login currently accepts provider profile payload in development mode (`ALLOW_SOCIAL_PROFILE_ONLY=true`).
  - Disable this in production and enforce verified provider tokens.

## Scripts

- `npm run dev` - start Vite frontend
- `npm run api` - start API server
- `npm run api:dev` - start API with Node watch mode
- `npm run lint` - run ESLint
- `npm run build` - build frontend
