# Aerovanta

Branding rollout checklist for repo rename, domains, and OAuth app names:

- [AEROVANTA_BRANDING_CHECKLIST.md](./AEROVANTA_BRANDING_CHECKLIST.md)

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

## Production Step 1: Environment and Secrets

1. Copy `.env.production.example` to your cloud environment variable store.
2. Set real values for:
   - `CORS_ORIGINS` (your exact frontend domain)
   - `ADMIN_EMAIL`
   - `GEMINI_API_KEY` (and optional OAuth provider IDs)
3. Keep these production-safe flags:
   - `NODE_ENV=production`
   - `FORCE_HTTPS=true`
   - `TRUST_PROXY=true` (when behind a load balancer/reverse proxy)
   - `SESSION_COOKIE_SECURE=true`
   - `ALLOW_SOCIAL_PROFILE_ONLY=false`
   - `EXPOSE_RESET_DEBUG_URL=false`
4. Do not store `.env` in git. Use provider secret manager only.
5. Rotate any API keys that were ever exposed in logs/chats.

The API now fails startup in production if critical hardening env is unsafe or missing.

## Cloudflare Path

For a cost-free deployment baseline, use Cloudflare:

1. Frontend: Cloudflare Pages
2. API: Cloudflare Worker + D1

3. Optional later: R2 only if you want persistent uploaded image storage and are willing to enable Cloudflare billing

See detailed checklist: `CLOUD_DEPLOYMENT_CLOUDFLARE.md`

## Scripts

- `npm run dev` - start Vite frontend
- `npm run api` - start API server
- `npm run api:dev` - start API with Node watch mode
- `npm run api:check-config` - validate production hardening env/config
- `npm run lint` - run ESLint
- `npm run build` - build frontend

