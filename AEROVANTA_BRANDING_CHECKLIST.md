# Aerovanta Branding Rollout Checklist

This is the remaining manual branding layer that should be completed outside the codebase.

## 1. Rename the local project folder

Do this only after stopping `npm run dev`, `npm run api`, and closing editors/terminals using the repo.

From the parent directory of this repo:

```powershell
Rename-Item "VerdentVisionFinal" "Aerovanta"
```

If your parent folder uses a different old name, replace it accordingly.

After that:

```powershell
cd C:\Users\CHARLES\Aerovanta
```

## 2. Rename the GitHub repository

Target recommendation:

- repository name: `Aerovanta`
- clone URL: `https://github.com/<your-user>/Aerovanta.git`

Manual steps in GitHub:

1. Open the repository.
2. Go to `Settings`.
3. Change the repository name to `Aerovanta`.
4. Save the rename.

GitHub says repository web traffic and git operations to the old URL are redirected, but they recommend updating your local remote afterward.

Update local git remote:

```powershell
git remote set-url origin https://github.com/<your-user>/Aerovanta.git
git remote -v
```

If you use GitHub Pages or GitHub Actions references anywhere outside this repo, update those too.

## 3. Choose final production domains

Recommended structure:

- frontend: `app.aerovanta.com`
- API: `api.aerovanta.com`
- marketing/root site: `aerovanta.com`

This keeps cookies, CORS, and OAuth configuration cleaner than mixing everything on one hostname.

## 4. Cloudflare Pages branding and domain setup

If you have not created Pages yet, create it directly with the Aerovanta branding.

Recommended:

- Pages project name: `aerovanta-web`
- default preview hostname: accept the new Pages project hostname
- custom production domain: `app.aerovanta.com`

Then set:

- `VITE_API_BASE_URL=https://api.aerovanta.com/api/v1`

## 5. Cloudflare Worker branding and domain setup

The Worker config in this repo already uses Aerovanta names:

- Worker name: `aerovanta-api`
- D1 database name: `aerovanta`
- R2 bucket name: `aerovanta-uploads`

Recommended custom domain:

- `api.aerovanta.com`

## 6. Google OAuth branding and origins

Current code path:

- Google uses the browser OAuth JS flow.
- The important production setting is the Authorized JavaScript Origin.
- Redirect URIs are only needed if you switch to a redirect-based Google flow later.

Recommended production values:

- Authorized JavaScript origins:
  - `https://app.aerovanta.com`
  - `http://localhost:5173`

Branding to update in Google Cloud:

1. OAuth consent screen / Branding page:
   - App name: `Aerovanta`
   - Homepage: `https://aerovanta.com`
   - Privacy policy: `https://aerovanta.com/privacy`
   - Terms of service: `https://aerovanta.com/terms`
2. OAuth client:
   - Make sure the production origin is added exactly.

## 7. Microsoft Entra branding and redirect URI

Current code path:

- Microsoft uses SPA auth with MSAL.
- Redirect URI must match `VITE_OAUTH_REDIRECT`.

Recommended production values:

- App registration name: `Aerovanta`
- SPA redirect URIs:
  - `https://app.aerovanta.com`
  - `http://localhost:5173`
- Frontend env:
  - `VITE_OAUTH_REDIRECT=https://app.aerovanta.com`

## 8. Facebook app branding

Current code path:

- Facebook uses the JS SDK.
- You should align the app display name and allowed domains with Aerovanta branding.

Recommended dashboard values:

- App display name: `Aerovanta`
- App domain: `aerovanta.com`
- Site URL: `https://app.aerovanta.com`

If the Facebook Login product requests Valid OAuth Redirect URIs, add:

- `https://app.aerovanta.com/`
- `http://localhost:5173/`

The exact dashboard fields may vary depending on the current Meta app configuration UI.

## 9. Final production env values

Recommended final frontend values:

```env
VITE_API_BASE_URL=https://api.aerovanta.com/api/v1
VITE_OAUTH_REDIRECT=https://app.aerovanta.com
```

Recommended final backend values:

```env
CORS_ORIGINS=https://app.aerovanta.com
ADMIN_EMAIL=admin@aerovanta.com
FORCE_HTTPS=true
TRUST_PROXY=true
SESSION_COOKIE_SECURE=true
```

## 10. Smoke test after external rename

After all branding/domain updates are done:

1. Load `https://app.aerovanta.com`
2. Confirm login page shows `Aerovanta`
3. Test Google login
4. Test Microsoft login
5. Test Facebook login
6. Confirm API requests resolve against `https://api.aerovanta.com/api/v1`
7. Confirm no old repo/domain/brand names appear in browser UI or console errors

## Official references

- GitHub repository rename:
  - https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository
- Cloudflare Pages custom domains:
  - https://developers.cloudflare.com/pages/configuration/custom-domains/
- Cloudflare Workers custom domains:
  - https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Google OAuth origins / setup:
  - https://developers.google.com/identity/oauth2/web/guides/load-3p-authorization-library
  - https://developers.google.com/identity/protocols/oauth2/policies
- Microsoft Entra SPA redirect URI setup:
  - https://learn.microsoft.com/en-us/graph/toolkit/get-started/add-aad-app-registration
