# Dev Resolve backend on Oracle Cloud (free) — with Neon as the off-site backup

The frontend stays on Vercel. The backend, its Postgres and HTTPS run on one **Oracle Cloud Always Free** VM
(4 ARM cores, 24 GB memory — no monthly cost), and every night a copy of the database goes to **Neon** (free).

Why Postgres on the VM and not on Neon: Neon's free plan gives ~400 database hours a month (100 CU-hours at the
smallest size), and Dev Resolve uses its database all day (the extensions check in every ~25 s), so a Neon-only
database would be paused around mid-month. A nightly copy needs only minutes of Neon time a day. To run on Neon
anyway, put its address in `/etc/dev-resolve/db.env` as `DATABASE_URL` / `MIGRATION_DATABASE_URL` and set
`DATABASE_SSL: "require"` in `docker-compose.yml`.

About an hour, once. Secrets never pass through chat or the repo: they go from Railway to the VM over SSH.

## 1. Oracle account and VM (console, ~15 min)

1. Sign up at **cloud.oracle.com** (a card is asked for verification; Always Free resources cost nothing).
   Home region: **India West (Mumbai)** or **India South (Hyderabad)** — it can't be changed later.
2. Recommended: **Billing → Upgrade to Pay As You Go**, then **Budgets → create a $1 budget alert**. Always Free stays
   free; paid accounts get ARM capacity more easily and their VMs aren't reclaimed when idle.
3. **Compute → Instances → Create instance**
   - Image: **Canonical Ubuntu 24.04** · Shape: **Ampere → VM.Standard.A1.Flex**, **4 OCPU, 24 GB**
   - Networking: create a new VCN with a **public subnet**, **Assign a public IPv4 address** ✓
   - SSH keys: **Generate a key pair** → download the private key (e.g. `~/.ssh/oracle-dev-resolve.key`, then `chmod 600` it)
   - Boot volume: 100 GB
   - "Out of capacity"? Try another availability domain, or again later.
4. Keep the address fixed: instance → **Attached VNICs → IPv4 addresses → Edit → Reserved public IP** (one is free).
   The HTTPS address is built from it.

## 2. Open ports 80 and 443 (console)

**Networking → Virtual cloud networks → your VCN → Subnets → public subnet → Default Security List → Add Ingress Rules**:
source `0.0.0.0/0`, TCP, destination port `80` — and the same for `443`. (setup.sh opens them on the VM itself.)

## 3. Set up the VM (one command)

```bash
ssh -i ~/.ssh/oracle-dev-resolve.key ubuntu@<VM-IP>
curl -fsSL https://raw.githubusercontent.com/bhavyanksarolia-shipsy/dev-resolve/main/deploy/oracle/setup.sh | bash
```

Installs Docker, gets the code into `/opt/dev-resolve`, creates the database (an owner role for migrations, an app role
for data only) and prints this backend's address: `https://<ip-with-dashes>.sslip.io`.

## 4. Copy the settings from Railway (on your Mac)

In Railway: **Postgres → Settings → Networking → enable the public (TCP proxy) address** (needed once for the copy).

```bash
cd ~/Documents/"Custom Project/Dev Resolve"
railway link                                   # pick the Dev Resolve project, if not linked
deploy/oracle/send-env.sh <VM-IP> ~/.ssh/oracle-dev-resolve.key
```

Nothing is shown on screen; it goes straight to `/etc/dev-resolve/app.env` on the VM (root only).

## 5. Copy the data and start (on the VM)

Ask the team not to use Dev Resolve for ~10 minutes (anything done on Railway after the copy isn't carried over).

```bash
/opt/dev-resolve/deploy/oracle/migrate-db.sh
```

Copies everything (investigations, users, config, knowledge, sign-ins — all of it is in the database), checks every
table's row count matches Railway, builds and starts Dev Resolve with HTTPS, and turns on auto-update. The Railway data
also stays as a file in `/var/backups/dev-resolve/`.

## 6. Point the frontend at it (Vercel)

Vercel → the Dev Resolve project → **Settings → Environment Variables → `BACKEND_URL` = `https://<ip-with-dashes>.sslip.io`**
→ **Deployments → Redeploy**. Sign-in, Google login and everything else work as before.

Then everyone **downloads the extension again** from the Connector page (it now talks to the new backend).

## 7. Neon backup (console + one command)

1. **neon.tech** → sign up → **New project**: Postgres 17, region **AWS Asia Pacific (Singapore)**.
2. **Connect** → copy the connection string (the **direct** one, not "pooled").
3. On the VM: `/opt/dev-resolve/deploy/oracle/backup.sh --set-neon` → paste it (hidden) → it backs up once to check.

From then on every night at 02:30 IST: a backup on the VM (kept 14 days) and the same copy in Neon.

## 8. Turn Railway off (after a day or two of everything working)

Railway → Dev Resolve service → **Settings → Delete**, and the same for Postgres.

## Everyday

| | |
|---|---|
| New commits on `main` | deployed by themselves within ~5 min (backend changes only; a failed build keeps the running version) |
| Status / logs | `dr ps` · `dr logs -f app` · `dr logs --tail 50 caddy` |
| Restart | `dr restart app` |
| Deploy now | `sudo /opt/dev-resolve/deploy/oracle/update.sh` |
| Update log | `journalctl -u dev-resolve-update -n 50` |
| Backups | `sudo ls -lh /var/backups/dev-resolve` · run one now: `/opt/dev-resolve/deploy/oracle/backup.sh` |
| More at once | `AGENT_MAX_PARALLEL=6` in `/etc/dev-resolve/compose.env`, then `dr up -d app` |
| Settings | `sudo nano /etc/dev-resolve/app.env`, then `dr up -d app` (most settings are in Admin anyway) |
