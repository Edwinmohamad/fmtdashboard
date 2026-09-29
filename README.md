# FMT Operations Dashboard

**Division:** FMT  
**Site:** TBS  
**Version:** 3.2.0

Facility Management operations, attendance PDF signing, inventory, change management, reports and audit trail.

## UI direction
Version 3.2 uses a restrained Apple-inspired design system: native system typography, neutral surfaces, subtle translucency, thin borders, consistent spacing, a single blue accent and carefully limited animation. No external font files are required.

## Local / server start
```bash
cp .env.example .env
docker compose up -d --build
```

Default internal application port: `8096`.

## GitHub workflow
Recommended source-of-truth workflow:
```bash
# on CasaOS
cd /DATA/AppData/fmt_dashboard/app
git pull --rebase origin main
docker compose up -d --build
```

## Important runtime data
Do not commit these to GitHub:
- `.env`
- `data/`
- `uploads/`
- `backups/`
- runtime logs

Keep `.env.example` committed.

## Signing workflow
Upload PDF → select authorized signature → drag/resize → optionally remember position → Final Preview → Sign Selected → server verification → Signed → Finalize.

A Signed document cannot be signed again directly. To intentionally re-sign, upload a fresh PDF revision from the document detail page; the old Signed version remains in history.

## Security
The development bootstrap can use `admin/admin` on a trusted LAN, but change this before exposing the service through a public domain or tunnel.
