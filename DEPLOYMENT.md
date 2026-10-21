# Cibus — Deployment Guide (cPanel shared hosting)

Case study / runbook for deploying the `cibus-website` monorepo to a cPanel host
(GoDaddy). Written after the first successful deploy to `dev.cibus.gy`.

---

## 1. The mental model

The app is **two separate things** on one domain:

| Part | What it is | Who serves it |
| --- | --- | --- |
| Website + admin UI | static files (React build) | Apache, as plain files |
| API (`/api/...`, `/health/...`) | a Node program that must be **running** | the Node process, reached through a proxy |

```
browser ─► Apache (docroot: ~/public_html/dev)
              ├─ file exists?  ─► serve it directly        (website, /assets/…)
              └─ not a file?   ─► proxy to localhost:4000   (API, /health)
                                       ▲
                                       └── Node: apps/api/dist/index.js
```

Two consequences that cause almost every problem:

- If the **Node process is not running**, every `/api` call returns **503** while
  the website still loads fine (Apache serves the files). This looks like "the
  API is broken" but it is usually just "the API is not started".
- If the **proxy rule is wrong**, the API receives the wrong path and the website
  gets HTML back where it expected JSON.

**cPanel "Application Manager" / Passenger was a red herring** on this host — it
failed with `Invalid configuration for the parameter "ruby"` and was never used.
The deploy that works uses an Apache `.htaccess` reverse proxy plus a cron-kept
Node process. (See §7 for the alternative.)

---

## 2. What exists where (this deployment)

| Item | Value |
| --- | --- |
| Host / domain | `dev.cibus.gy` (`107.180.114.67`) |
| cPanel user | `tpzoid5jbl7z` |
| Node (via nvm) | `/home/tpzoid5jbl7z/.nvm/versions/node/v22.23.3/bin/node` |
| App checkout (API runs here) | `~/cibus-website` |
| Web docroot (static site) | `~/public_html/dev` |
| Proxy rule | `~/public_html/.htaccess` |
| API settings | `~/cibus-website/apps/api/.env` |
| API log | `~/cibus-website/api.log` |
| Keep-alive script | `~/cibus-website/keep-api.sh` |
| Database | MySQL `cibus_dev`, user `cibus` |
| API port | `4000` |

---

## 3. Prerequisites

- cPanel access with **Terminal / SSH**.
- **Git Version Control** pointing at `https://github.com/sureshturbo/cibus-website.git`.
- A MySQL database + user created in cPanel (**MySQL Databases**).
- Node 22 available on the server (`node -v`).

---

## 4. Deploy steps

### 4.1 Get / update the code

Via cPanel → **Git Version Control** → *Update from Remote* → *Deploy HEAD commit*,
or in Terminal:

```bash
cd ~/cibus-website
git fetch origin
git reset --hard origin/main
```

> If a stray untracked file blocks the reset (e.g. a hand-made `app.js`):
> `git reset --hard origin/main` will complain. Remove it first: `rm -f app.js`.

### 4.2 Install dependencies and build

```bash
cd ~/cibus-website
export NPM_CONFIG_PRODUCTION=false     # MUST: NODE_ENV=production otherwise skips devDeps
npm install
```

**Do not build the UIs on the server.** The host's container (CloudLinux
cgroup/LVE) caps tasks at ~4, so esbuild cannot spawn and every `vite build`
dies (see §6.3). `tsc` is fine, so the API and shared DO build here:

```bash
npm run build --workspace @cibus/shared
npm run build --workspace @cibus/api
```

Build `apps/storefront` and `apps/admin` **on your workstation**, then upload
the `dist/` output (§4.5).

### 4.3 Create the API settings file

cPanel environment variables **do not reliably reach the Node process**, and
without them `config/env.ts` boots with defaults and the production guard
refuses to start (`ChangeMe!2026` password, `localhost` CORS). Put them in
`apps/api/.env` instead — the app loads it itself.

```bash
cat > ~/cibus-website/apps/api/.env <<'EOF'
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
API_BASE_URL=https://dev.cibus.gy
DATABASE_URL=mysql://cibus:<DB_PASSWORD_URLENCODED>@127.0.0.1:3306/cibus_dev
JWT_ACCESS_SECRET=<48+ random chars>
JWT_REFRESH_SECRET=<48+ random chars>
CORS_ORIGINS=https://dev.cibus.gy
TRUST_PROXY=true
SERVE_UPLOADS=true
UPLOAD_DIR=/home/tpzoid5jbl7z/cibus-website/uploads
STOREFRONT_DIR=/home/tpzoid5jbl7z/cibus-website/apps/storefront/dist
ADMIN_DIR=/home/tpzoid5jbl7z/cibus-website/apps/admin/dist
SEED_ADMIN_EMAIL=admin@cibus.local
SEED_ADMIN_PASSWORD=<strong password>
EOF
```

> URL-encode special characters in the password (e.g. `,` → `%2C`, `^` → `%5E`, `#` → `%23`).

Sanity check it boots (it will stop itself after 15s — that is success):

```bash
cd ~/cibus-website
timeout 15 node apps/api/dist/index.js
# expect: database.ready ... server.started ... then exit code 124
```

### 4.4 Import the database

cPanel → **phpMyAdmin** → select the database → **Import** → `cibus-setup.sql`
(schema + migrations markers + seed data). This is the cPanel equivalent of
`npx prisma migrate deploy && npx tsx prisma/seed.ts` and needs no server env.

### 4.5 Publish the website files

The docroot (`~/public_html/dev`) serves the storefront as static files, so copy
the fresh build there. The build is produced on your workstation (§4.2) and
transferred as a forward-slash tarball:

```bash
cd ~/public_html/dev
rm -rf assets images index.html favicon.png apple-touch-icon.png
tar -xzf ~/storefront-dist.tar.gz
```

> The docroot also contains a hand-made ~26 KB `index.html` that is NOT the React
> app. The React shell is ~1 KB — if `/` is not the SPA, the build was never
> published. Keep the old docroot `.env`/`.htaccess`; only the built files are
> replaced.

The admin UI is served by the API from `ADMIN_DIR`, so it goes to
`~/cibus-website/apps/admin/dist` (not the docroot):

```bash
mkdir -p ~/cibus-website/apps/admin/dist
cd ~/cibus-website/apps/admin/dist
tar -xzf ~/admin-dist.tar.gz
```

### 4.6 Proxy `/api` and `/health` to the Node process

`~/public_html/.htaccess` (see §6.4 for why the pattern includes `dev/`):

```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^dev/(.*)$ http://localhost:4000/$1 [P,L]
```

### 4.7 Start the API

```bash
cd ~/cibus-website
setsid nohup node apps/api/dist/index.js > ~/cibus-website/api.log 2>&1 < /dev/null &
```

### 4.8 Make it survive reboots / crashes (cron keep-alive)

`~/cibus-website/keep-api.sh`:

```bash
#!/bin/bash
cd /home/tpzoid5jbl7z/cibus-website
if ! pgrep -f "apps/api/dist/index.js" >/dev/null 2>&1; then
  setsid nohup "/home/tpzoid5jbl7z/.nvm/versions/node/v22.23.3/bin/node" \
    apps/api/dist/index.js >> /home/tpzoid5jbl7z/cibus-website/api.log 2>&1 < /dev/null &
fi
```

```bash
chmod +x ~/cibus-website/keep-api.sh
( crontab -l 2>/dev/null | grep -v keep-api.sh; \
  echo "*/5 * * * * /bin/bash /home/tpzoid5jbl7z/cibus-website/keep-api.sh >/dev/null 2>&1" ) | crontab -
```

Use the **absolute node path** in the script: cron has no nvm `PATH`.

### 4.9 Verify

```bash
curl -k https://dev.cibus.gy/health/ready        # {"status":"ready",...}
curl -k https://dev.cibus.gy/api/public/config   # {"success":true,...}
curl -k -o /dev/null -w "%{http_code}\n" https://dev.cibus.gy/   # 200
```

Then open the site in a browser and sign in.

---

## 5. Accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@cibus.local` | (from the SQL seed — see file header) |
| Customer | `customer@cibus.local` | `Customer!2026` |

---

## 6. Problems hit and how they were solved (the important part)

### 6.1 `503` on every `/api/*`, but the website loads
The Node process was not running. The `.htaccess` proxy had nothing to talk to.
Fix: start the API and install the cron keep-alive (§4.7–4.8).

### 6.2 The process started but exited instantly, and env was missing
cPanel env vars did not reach the process, so `config/env.ts` used defaults and
the production guard aborted the boot. Fix: `apps/api/.env` (§4.3).

### 6.3 Build failed: `failed to create new OS thread ... errno=11`
`vite build` uses **esbuild**, a Go binary that spawns threads; on this host it
cannot, because the account's **cgroup/LVE caps tasks at ~4**. Symptoms are
interchangeable: `failed to create new OS thread (have 4 already; errno=11)`,
`spawn .../esbuild EAGAIN`, or `pthread_create: Resource temporarily
unavailable`. **`GOMAXPROCS=1` and `ESBUILD_WORKER_THREADS=0` do NOT fix it**,
and neither does `ulimit -u` — it already reads 287658, because a cgroup limit is
not a shell limit. `tsc` (Node) builds fine.

**Fix: build the UIs on your workstation and upload `dist/`.**
```bash
# on the workstation, in apps/storefront and apps/admin:
npm.cmd run build
# package with forward-slash paths (PowerShell's Compress-Archive writes
# backslashes, which Linux unzip renders as literal "assets\file" names):
tar.exe -czf storefront-dist.tar.gz -C apps/storefront/dist .
scp storefront-dist.tar.gz user@host:~/storefront-dist.tar.gz
# on the server:
cd ~/public_html/dev && tar -xzf ~/storefront-dist.tar.gz
```
Converting a PuTTY `.ppk` for the workstation's OpenSSH `scp`: no `puttygen`/
`pscp` is installed, so convert the key (it is a plain RSA key when
`Encryption: none`) or add it via cPanel → SSH Access.

### 6.4 `/api` returned the website's HTML instead of JSON
The proxy rule lived in `~/public_html/.htaccess` (a folder *above* the `dev`
site), so it forwarded `/api/...` as `dev/api/...`. The API had no routes for
`/dev/api/...` and served the SPA fallback. **Fix:** change the pattern to
`^dev/(.*)$` so the extra segment is stripped (§4.6). Evidence is in `api.log`:
paths arrived as `/dev/api/public/config`.

### 6.5 `Invalid configuration for the parameter "ruby"` (cPanel Application Manager)
Unrelated to the app. Application Manager/Passenger couldn't register the app;
it stayed invalid and never launched anything. Not used. Safe to delete that
registration to avoid confusion.

### 6.6 `npm warn config production` during install
Harmless on its own, but `NODE_ENV=production` makes `npm install` skip
devDependencies and the build then fails. Always `export NPM_CONFIG_PRODUCTION=false`.

### 6.7 Two code copies on the server
- `~/cibus-website` — where the API is built and run.
- `~/public_html/dev` — a second checkout **and** the web docroot serving the
  storefront as static files.

They are not linked. After every rebuild you must re-copy the storefront
(`cp -a apps/storefront/dist/. ~/public_html/dev/`). This is fragile — see §7.

---

## 7. Notes / possible improvements

- **Better long-term option:** cPanel's **"Setup Node.js App"** (Node.js
  Selector) runs the app under Passenger, passes env vars natively, and has
  start/stop/restart and a log viewer. It would remove the `.htaccess` proxy,
  the background process and the cron keep-alive. Not set up yet (no
  `~/nodevenv` exists). Consider migrating to it.
- **Port 4000** must stay free and match the proxy rule.
- **Security:** rotate the DB password and the JWT secrets that passed through
  chat/logs. Keep `apps/api/.env` out of git (it is gitignored).
- The website could be served entirely by the API (`STOREFRONT_DIR`) if the
  proxy also matched the domain root; today the static copy in the docroot
  serves it. Fixing the rule to also proxy `/` would make one copy authoritative.

---

## 8. Maintenance cheat sheet

```bash
# Update & redeploy
cd ~/cibus-website
git fetch origin && git reset --hard origin/main
export NPM_CONFIG_PRODUCTION=false
npm install
# API + shared build here; the UIs CANNOT (esbuild cgroup cap — build them on a
# workstation and upload the tarballs, see §4.5 / §6.3):
npm run build --workspace @cibus/shared
npm run build --workspace @cibus/api
cd ~/public_html/dev && tar -xzf ~/storefront-dist.tar.gz
bash ~/cibus-website/keep-api.sh

# Restart the API (cron also revives it within 5 min)
pkill -f "apps/api/dist/index.js"

# Logs
tail -f ~/cibus-website/api.log

# Health
curl -k https://dev.cibus.gy/health/ready
```

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `/api` → 503, site loads | API process not running | `bash ~/cibus-website/keep-api.sh` |
| `/api` → 503 and `api.log` empty | env/DB wrong | check `apps/api/.env`, `timeout 15 node apps/api/dist/index.js` |
| `/api` → HTML, not JSON | proxy path wrong | fix `~/public_html/.htaccess` pattern |
| Build dies: `new OS thread` / esbuild `EAGAIN` | esbuild blocked by cgroup task cap | build the UIs on a workstation, upload `dist/` (§6.3) |
| Install skips dev deps | `NODE_ENV=production` | `export NPM_CONFIG_PRODUCTION=false` |
| Website looks stale | docroot copy not refreshed | re-extract the storefront tarball into `~/public_html/dev` |
| `/` shows a 26 KB page, not the app | old hand-made `index.html` still in docroot | extract the storefront build over it |
