# Cloudflare Deployment Checklist (Point-by-Point)

This checklist targets a no-billing baseline using Cloudflare services.

## Point 1: Environment and Secrets

1. Use `.env.production.example` as your source template.
2. Put all secrets in Cloudflare secrets, not in git:
   - `GEMINI_API_KEY`
   - `OPENAI_API_KEY` (optional fallback)
   - OAuth client secrets (if used)
3. Keep these production flags:
   - `NODE_ENV=production`
   - `FORCE_HTTPS=true`
   - `TRUST_PROXY=true`
   - `SESSION_COOKIE_SECURE=true`
   - `ALLOW_SOCIAL_PROFILE_ONLY=false`
   - `EXPOSE_RESET_DEBUG_URL=false`
4. Run local preflight:
   - `npm run api:check-config`

## Point 2: Frontend on Cloudflare Pages

1. Build command: `npm run build`
2. Build output directory: `dist`
3. Add Pages environment variables:
   - `VITE_API_BASE_URL=https://<your-api-domain>/api/v1`
   - OAuth IDs as needed
4. Add custom domain and enforce HTTPS.

## Point 3: Backend on Cloudflare Worker (Migration Path)

Current repository backend is Node `http` + filesystem (`server/data`, `server/uploads`).
Cloudflare Worker runtime needs route migration to Worker handlers and D1 storage.

For the no-billing path:

- Use `Cloudflare Pages + Workers + D1`
- Do not enable `R2`
- Do not expect persistent cloud image storage yet
- Uploaded images must remain transient until upload/diagnosis routes are migrated specifically for the Worker path

Starter scaffold included:

- `cloudflare/worker/wrangler.toml`
- `cloudflare/worker/src/index.js`

### 3A. Create Cloudflare resources

1. `wrangler login`
2. `wrangler d1 create aerovanta`
3. Copy D1 `database_id` into `cloudflare/worker/wrangler.toml`


### 3B. Configure Worker

1. Set `CORS_ORIGINS` in `wrangler.toml` to your frontend domain.
2. Set `ADMIN_EMAIL` in `wrangler.toml`.
3. Add secrets:
   - `wrangler secret put GEMINI_API_KEY`
   - `wrangler secret put OPENAI_API_KEY` (optional)
4. Deploy:
   - `cd cloudflare/worker`
   - `wrangler deploy`

### 3C. Health checks

After deploy verify:

1. `GET /healthz` returns `200`.
2. `GET /readyz` returns `200` when D1 is configured and the schema is applied.

### 3D. Initialize D1 schema and import current local state

1. Apply schema:
   - `wrangler d1 execute aerovanta --file cloudflare/d1/schema.sql`
2. Export your current local JSON state into D1 seed SQL:
   - `npm run cloudflare:d1:export-seed`
3. Import generated data:
   - `wrangler d1 execute aerovanta --file cloudflare/d1/seed.generated.sql`
4. Re-check readiness:
   - `GET /readyz`
5. Delete the generated seed file after import. It contains real application data and is git-ignored by default.

### 3E. First routes already migrated

These routes are implemented in the Worker now:

1. `GET /api/v1/auth/me`
2. `POST /api/v1/auth/login/email`
3. `POST /api/v1/auth/register/email`
4. `POST /api/v1/auth/logout`

Social login is still not migrated in the Worker path yet.

### 3F. Manual smoke test after deploy

1. Open your deployed frontend.
2. Register a new email account.
3. Refresh the page and confirm session persists.
4. Call `GET /api/v1/auth/me` from the app and confirm user data loads.
5. Logout and confirm you return to unauthenticated state.

## Point 4: Data layer migration

1. Replace JSON database operations in `server/src/database.js` with D1 queries.
2. For a strict no-billing deployment, replace upload file writes with transient request payload handling and store only diagnosis/post metadata in D1.
3. If you later enable billing, you can switch persistent uploads to R2 object writes.
4. Preserve existing API contract (`/api/v1/...`) to avoid frontend breakage.

## Current limitation of the no-billing path

The Worker scaffold currently supports only the migrated auth routes plus health/readiness.

That means:

1. Email auth can be deployed on Cloudflare now.
2. D1-backed sessions can be deployed on Cloudflare now.
3. Persistent image uploads are not part of the free no-billing path yet.
4. Diagnosis/chat/community image flows still need dedicated Worker route migration before the whole app can run only on Cloudflare.

## Point 5: Rate limiting

Current API uses in-memory rate limiting.

For production multi-instance, enforce rate limiting at edge/gateway:

1. Cloudflare WAF/Rules for request throttling.
2. Keep app-level limits for defense-in-depth.

## Point 6: Launch gate

Only go live when all are true:

1. Frontend domain + API domain are HTTPS-only.
2. `api:check-config` passes with production env.
3. `/healthz` and `/readyz` are green.
4. Secrets rotated and not present in repository history.
5. Auth, diagnosis, planner, admin flows pass smoke tests.

