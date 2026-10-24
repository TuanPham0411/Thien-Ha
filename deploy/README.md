# Deploy to th-server

## What has and has not been verified

The existing `.github/workflows/pi-check.yml` was inspected before changes and is preserved. It is a manual diagnostic workflow with no deployment/build steps. The existing remote `pi-build.yml` was also inspected after fetching the latest main: it built static sites on GitHub and only staged them under the runner home directory. That workflow has been upgraded in place. The updated `pi-build.yml` builds/tests on GitHub, then deploys `main` on `[self-hosted, Linux, ARM64]` and checks that the selected runner's name is `th-server`. Runner name is not assumed to be an automatic label.

The installer has no Cloudflare or SSH mutation commands. Live deployment still requires repository push/Actions access; local checks do not prove live Pi/domain health.

## First installation

`th-server` has now been initialized with the root-owned deployment entrypoint. The normal workflow uses only that command. For a different fresh Pi, download/extract a built artifact and run `sudo bash ARTIFACT/deploy/install.sh ARTIFACT RELEASE_ID` once from an administrative shell before enabling automatic deployment. The installer creates the dedicated sudo rule after a healthy rollout.

1. Push reviewed source to `main` (or manually run **Build and deploy Pi** on `main`). GitHub builds both static sites, the dependency-bundled API/migration runner, and downloads/checksums the official Node.js 22 Linux ARM64 runtime. No Node/npm preinstallation or compilation on Pi is needed. Deployment receives only the artifact and verifies its SHA-256 checksum.
2. Installer checks ARM64, existing Nginx/PostgreSQL services and overlapping host blocks. If an enabled Nginx site already owns either hostname, deployment stops **before changes** with a specific conflict message. Review `sudo nginx -T` on Pi and consolidate only those two host blocks. Preserve all other hosts and the Tunnel's existing local origin/port. The supplied configuration listens on port 80; if the existing Tunnel uses another port, adjust `deploy/nginx.conf` to that existing origin before deploying. The installer never edits the Tunnel.
3. On first successful installation, the installer creates system user `thapp`, database `th_app`, database login `th_api` with a random password, `/var/lib/th-app/files`, and root-only `/etc/th-app/runtime.env`. Existing database/role name collisions stop provisioning; it does not drop existing databases. Runtime DB role cannot read MES credential tables or invoke bootstrap activation directly.
4. Configure Google OAuth and email locally on Pi using `sudoedit /etc/th-app/runtime.env`. See `runtime.env.example`; never put secrets in Vite variables, Git or Actions logs. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SMTP_URL`, `MAIL_FROM`; set `OWNER_EMAIL` to the intended verified Google owner before first login. Register both exact OAuth callback URLs:
   - `https://th.io.vn/api/oauth/callback`
   - `https://mes.th.io.vn/api/oauth/callback`
5. Restart only the app: `sudo systemctl restart th-app`. Email/password registration and outgoing verification/reset require SMTP; Google sign-in requires the OAuth client. Missing settings fail explicitly. Public sites and local MES account activation work independently.
6. If using password activation for the initial MES owner, run locally (this prints a **secret activation code**; do not paste it into CI logs):

   ```sh
   sudo -u postgres psql th_app -Atc 'select public.mes_issue_owner_activation();'
   ```

   Open `https://mes.th.io.vn/#activate=CODE&username=hpham`, then choose a password. Activation is single-use, expires in 72 hours, and returns `already-activated` once the owner password is set. Google owner login can be used instead. The old Windows-agent sign-in is disabled by the existing account migration.

## Cloudflare routes

The Pi application is installed and its local HTTP/API checks pass. Public checks initially returned Cloudflare HTTP 404; the owner confirmed that the portfolio route had not yet been created.

In Cloudflare Zero Trust, open the **existing** tunnel under Networks → Tunnels/Connectors, then Published application routes (also called Public Hostnames). Add these entries with no path restriction:

| Public hostname | Service type | Service URL |
| --- | --- | --- |
| `th.io.vn` | HTTP | `localhost:80` |
| `mes.th.io.vn` | HTTP | `localhost:80` |

For the root hostname, leave Subdomain empty and select domain `th.io.vn`; for MES, set Subdomain to `mes`. Leave HTTP Host Header override unset so Nginx receives the original hostname. Preserve the existing SSH route. The dashboard normally creates the DNS record for a new route; resolve any conflicting DNS record for that same hostname deliberately. No tunnel token, SSH unit or tunnel service command is changed by the application deployment.

If `mes.th.io.vn` does not resolve, create/check a proxied DNS CNAME named `mes` in the `th.io.vn` zone, pointing to the same `TUNNEL_ID.cfargotunnel.com` target as the root domain. Editing a route hostname does not always synchronize an existing DNS record.

After saving the routes and DNS, rerun the **verify-public** job in the latest Actions run. It tests the two public HTTPS roots, both `/api/health` endpoints and the MES API version. OAuth and email need the runtime settings described above as separate integration checks.

## Sudo bootstrap

The runner initially required a sudo password despite the earlier cached `sudo -n true` check. One-time password transport uses RSA-OAEP-SHA256 with a private key generated on Pi under `/var/tmp/th-pi-deploy-auth` (mode 700). Only the public key and encrypted ciphertext pass through GitHub; the password is piped directly into `sudo -S` and never logged or written as plaintext. The key is deleted after the bootstrap attempt. The temporary ciphertext has been removed from the current workflow after successful bootstrap. The bootstrap transport is not needed by the normal workflow.

A successful install creates the root-owned `/usr/local/sbin/th-deploy` entrypoint and `/etc/sudoers.d/th-app-deploy`, allowing only that deployment command without a password for `thadmin`. Subsequent releases invoke this entrypoint; the runner has no need for passwordless arbitrary shell commands. Keep repository workflow write access restricted to trusted maintainers, since deployment artifacts include service configuration and migrations.

## Runtime and resources

One process, PostgreSQL pool max 4, Node heap 192 MB, service memory cap 320 MB. Static files are served directly by Nginx. No Docker, npm install or frontend build on Pi. Releases live under `/opt/th-app/releases`; the atomic `current` symlink selects the active release. Three releases are retained after successful deployment. Attachments are stored outside releases and survive redeploys.

PostgreSQL is already installed: inspect its current memory settings rather than overwriting global configuration. For this machine, a conservative starting point is `shared_buffers=64MB`, `work_mem=2MB`, `maintenance_work_mem=32MB`, `max_connections=20`, provided other applications fit those limits. No global PostgreSQL setting is changed automatically.

The API listens on loopback only. Nginx overwrites forwarded host/address headers. With a loopback Cloudflare Tunnel the built-in rate limit may be shared across clients (180 requests/minute; auth 30/15 minutes). Configure trusted client IP handling only after verifying the actual Tunnel path; do not trust arbitrary browser-supplied forwarded headers. Keep PostgreSQL local and retain the current firewall/SSH setup.

## Health, rollout and rollback

Deployment runs transactional, versioned migrations, switches the release symlink, checks Nginx syntax, restarts the API, polls database health, reloads Nginx, then checks both host roots and MES directory API. It confirms that SSH, cloudflared, Nginx and PostgreSQL remain active. A failure during switching restores the old application/configuration. SQL migrations remain applied; future migrations must stay backward compatible or have a deliberate database recovery plan.

Check on Pi:

```sh
sudo systemctl status th-app nginx postgresql cloudflared ssh --no-pager
curl -f http://127.0.0.1:3000/api/health
curl -f -H 'Host: th.io.vn' http://127.0.0.1/
curl -f -H 'Host: mes.th.io.vn' http://127.0.0.1/
sudo journalctl -u th-app -n 50 --no-pager
```

Then check both public HTTPS domains, Google owner login, email verification/reset, a non-owner account, and an upload/download. These external integrations cannot be fully verified without the real OAuth/SMTP settings and domain access.

Manual application rollback (choose an actual previous release ID):

```sh
sudo ln -s /opt/th-app/releases/PREVIOUS_ID /opt/th-app/.rollback
sudo mv -Tf /opt/th-app/.rollback /opt/th-app/current
sudo systemctl restart th-app
```

For backups, retain PostgreSQL dumps **together with** `/var/lib/th-app/files` and `/etc/th-app/runtime.env` on another device. Stop the app while taking the dump/file snapshot if a consistent maintenance backup is required. Monitor `df -h /` and attachment growth on the 32 GB card; failed/crashed uploads can leave temporary files and unattached uploads for administrator cleanup. Never delete live linked attachments by age alone.

## Credential rotation

Rotate credentials if they have been shared in a screenshot or other unintended location. Enter replacements directly on Pi using `sudoedit /etc/th-app/runtime.env`; do not put them in Git or CI logs.

- **Google OAuth:** add a new client secret in Google Auth Platform → Clients, update `GOOGLE_CLIENT_SECRET`, restart `th-app`, test a fresh login, then delete the old client secret.
- **Gmail SMTP:** create a replacement App Password, update the password in `SMTP_URL`, then revoke the old App Password. Remove display spaces from the App Password. For an initial Gmail delivery test, set `MAIL_FROM` to the authenticated Gmail address; a custom sender needs the provider's verified sender configuration.
- **PostgreSQL:** stop only `th-app`, open `sudo -u postgres psql -d th_app`, run `\password th_api` and enter the new password at the hidden prompts, then `\q`. Update the password component of `DATABASE_URL` to match; percent-encode reserved URL characters. Restart `th-app` and check `/api/health`. Keep the existing database, tables, files and role name.

Apply environment changes with `sudo systemctl restart th-app`. This does not restart SSH or Cloudflare Tunnel. OAuth callback requests must begin from a fresh Google login after a deployment or secret change; an old callback URL may have an expired state or authorization code.

### MES account administration

Sign in as the MES owner and open Administration → User directory. Click a user's display name or Edit to change username, display name, email, phone and job title. New activation link invalidates previous activation links, password and sessions; the replacement link is shown inside the account dialog, expires after 72 hours and is single-use. Restore inactive accounts before issuing a link. Deactivate revokes sessions; Delete account permanently removes the account and credentials while preserving historical feedback. Owner and reserved tester accounts cannot be deleted through this screen.

Ordinary users can change only their own display name, email, phone, job title and password through My profile. Account ownership and access state are enforced in PostgreSQL, independently of browser controls. Changing a username revokes existing sessions.

Dashboard filters group status, priority and performance by submission date. Activity counts submissions and resolutions independently over the selected calendar horizon, with at most 12 date buckets. Average resolution includes completed tickets with valid recorded timestamps; an em dash means no usable samples. Animations run on navigation or changed data, respect reduced-motion preferences and use browser compositing rather than an additional chart runtime on the Pi.

### Operations Studio: publishing and capture

The MES now uses horizontal workspace navigation with persistent Day/Night mode (top toolbar). Admin controls are under Administration:

- **Notice board management:** create/edit notices, pin, publish/unpublish or delete. Drafts are visible only to the owner; signed-in workspace members see published notices on Dashboard.
- **Workspace video playlist:** upload MP4, WEBM or MOV with a title, rename or delete. Videos stream from the Pi with HTTP range support. Playback starts muted and supports next/previous, automatic advance and single-video looping. MP4 H.264 is recommended for broad device support; no transcoding runs on the Pi. Maximum 20 videos, 200 MB/video.
- **Issue types:** add, rename, disable/restore or delete categories. New feedback records the category ID and historical name. Older tickets remain Unclassified; editing/deleting a category does not rewrite history. General is retained as the compatibility default for older clients.
- **Ticket progress:** the owner sets 0–100% in Issue handling. Resolved/Closed tickets are always 100%. Members see progress in the ticket list, details and recent tickets. Existing tickets use a status-based estimate until the first explicit handling update. Department and issue-type charts follow the reporting period.
- **Evidence capture:** feedback supports browser camera snapshots/recording and native device capture inputs. Browser capture is video-only (no microphone), up to 60 seconds; all camera tracks stop on close, leaving the form or hiding the tab. Images show thumbnails and render directly in ticket details; ticket videos appear as download links. Keep photos/documents ≤10 MB and ticket videos ≤200 MB, maximum five attachments. Workspace media and ticket files share a 2 GiB application quota; quotas are admission limits with a small bounded allowance for simultaneous streamed ticket uploads. The server streams files and does not buffer/transcode videos on the Pi.

Network monitoring has been removed from the dashboard, administration API and service scheduler. Existing targets are disabled by migration; historical log tables are retained but are no longer exposed or populated.

Notice-board attachments are owner-published JPEG/PNG/WEBP images (10 MB) and MP4/WEBM/MOV videos (200 MB), up to five per notice. Members can access notice media only while a published notice references it; unpublished/draft media is owner-only. Playlist and notice media remain separate.

All video paths now accept up to 200 MiB per file for owners and ordinary users. Browser uploads use authenticated 4 MiB chunks, persisted offsets and automatic retry/resume during an upload. This keeps each Cloudflare request small even on a plan with a lower per-request body limit. The Pi streams each chunk to disk without holding a database connection for the transfer, atomically publishes the complete file, rechecks access on each chunk and expires abandoned sessions after two hours. A shared 2 GiB application quota remains in force. The service cleanup removes expired partial files hourly. Existing single-request upload endpoints remain available for compatibility, with the same per-video limit; new clients always use chunks.

MES Nginx accepts up to 201 MiB bodies; the normal browser chunk size remains 4 MiB. Cloudflare Tunnel and SSH configuration are unchanged.

## MES update: USB storage, backup, access history and translation

Upgrades now stop the app briefly, take a verified pre-migration snapshot under
`/var/lib/th-app/backups/pre-deploy-*`, and compare a fingerprint of every existing
ticket and timeline row before/after migration. A failed snapshot aborts deployment
and restarts the prior app. No existing tickets or accounts are reset. Local
snapshots use hardlinks for immutable originals where possible; these are rollback
protection, not protection from card failure. External USB files which cannot be
hardlinked are recorded as unchanged external references in these rollback
manifests instead of copying a full drive onto the SD card; only the explicit
USB backup operation makes a complete portable copy. They are not automatically deleted.

In **Administration → Storage and USB backup**:

1. Refresh drives. For an existing unmounted USB partition, select it and choose
   **Mount existing partition**. This mounts by UUID under `/mnt/th-usb-<UUID>` and
   adds a boot-safe fstab entry only if that UUID has no existing entry. The app
   never partitions or formats a drive. Unrecognised/blank drives require OS setup.
2. Choose **New file storage → Use for new files**, or configure an overflow USB.
   Active storage supports ext4/ext3/XFS/Btrfs and FAT/exFAT/NTFS when the OS
   driver works (ext4 is recommended). The mount action assigns portable filesystems
   to thapp with a private umask; no format or content deletion is performed.
   Filesystems without hardlinks publish by exclusive copy, so a final upload
   briefly needs space for both the upload fragment and completed original. Mount active storage under `/mnt`
   or `/media`, accessible to `thapp`; mounts inside home directories are hidden
   by the app service's sandbox.
3. Existing files stay in place and retain their URLs. New files go to the chosen
   drive. An internal primary switches new writes to the configured overflow USB
   below 512 MiB free. USB selection never moves PostgreSQL off the SD card.
   Keep the card from filling with other OS files. An unplugged selected drive
   rejects uploads instead of silently writing into its empty mount directory.
4. Select a backup destination and **Back up now**. Keep all registered storage
   drives connected. Writes are blocked until active uploads finish and the
   database plus originals have been copied. Read-only viewing continues. The
   result includes `database.dump`, `files/`, SHA-256 checksums and a completion
   manifest in `th-mes-backups/<timestamp-id>/`. A failed/incomplete backup has
   no completion manifest. Nothing is removed from the live system. Prefer a
   different USB for backups. The UI does not delete or restore live data.
5. Optional: **Create previews for existing images** creates display thumbnails
   in the admin's browser, uploads them alongside originals and reports failures.
   Keep that browser tab open until finished. New image uploads create previews
   automatically. Originals, attachment metadata and ticket history are unchanged.

Private media uses stable authenticated URLs, byte ranges, ETags and browser
revalidation. Thumbnails are limited to 256 KiB and have a separate URL. Videos
stream through the authenticated endpoint and can start without downloading the
whole file; source encoding and upstream bandwidth still affect startup time.
Calibri is the default; bundled open-source Carlito is the fallback on devices
without Calibri. Optional feedback fonts use the device's installed families.

**User access history** is admin-only, with username filtering and pagination. It
records sign-in attempts, activation, sign-out and application page visits from
this update onward. It never stores passwords, activation codes, session tokens,
OAuth secrets or feedback bodies. Only loopback Cloudflare Tunnel connections may
supply the real client IP to Nginx; other clients cannot forge forwarded addresses.
Users can comment on visible tickets; author identity comes from their session.
Handling fields remain owner-only. Old timeline entries are unchanged.

For Vietnamese → English translation, enable Google Cloud Translation API (v2)
and billing in your Google Cloud project, create an API key restricted to that API,
then edit `/etc/th-app/runtime.env` using `sudoedit` and add:

```dotenv
GOOGLE_TRANSLATE_API_KEY=<your-private-key>
# Optional aggregate original media quota; default 64 GiB, not preallocated.
STORAGE_QUOTA_BYTES=68719476736
```

Restart with `sudo systemctl restart th-app`. The key stays server-side. Users
press **Translate my feedback to English** on their ticket and confirm sending
only the title and feedback text to Google. Attachments/account details are not
sent. Translations are cached against the source text and shown separately;
the original content, formatting and history are never overwritten. No API key
means the UI reports that translation is not configured.

### Recovery reference (operator only)

Keep the existing runtime environment securely; backups intentionally exclude
OAuth/SMTP/API keys and OS configuration. Do not run restore on the live database
until a replacement database has been restored and checked separately. Verify
`sha256sum -c files.sha256` from a completed backup directory. Restore
`database.dump` with PostgreSQL `pg_restore` into a new database using matching
roles/privileges; restore `files/` under the configured file root with `thapp`
ownership. Relative `issues/<ticket>/<slot>` and `media/<id>` paths plus the
unchanged database IDs preserve dashboard links. In the replacement database,
discard uncompleted `mes_uploads` rows, expired grants and old sessions, then run
the migration runner to reapply runtime grants. Test sign-in and representative
attachments before switching the service to that replacement. Restoring is an
explicit operator procedure; deployment never invokes it automatically.

## Physical Pi status screen

On Raspberry Pi, `th-status.service` displays a read-only terminal dashboard on VT8 and starts at boot. It refreshes every five seconds with API/database health, app/Nginx/PostgreSQL/tunnel states, CPU load/temperature, RAM, disk, uptime and local interface addresses. It reads no credentials or ticket contents and makes no public-network requests. Use Ctrl+Alt+F1 for the normal login console; Ctrl+Alt+F8 returns to status. The status process runs as `thapp`; only fixed VT switching commands run as root. Hosts without Linux virtual consoles skip this integration.

### Incident timeline, search and access roles

Issue search includes Closed tickets and supports reporter name/username, ticket
number, title, issue type, department, description and assessment. Search ignores
case and Vietnamese accents; type/status/department/priority filters combine.
Historical catalog labels remain selectable.

The main incident timeline uses `occurrences`, never ticket creation time. A sweep
of merged per-ticket intervals computes exact concurrent load; a ticket counts
once even when its own reported ranges overlap. The compact chart separates three
aligned tracks: a blue line of peak concurrent tickets per hour/day, severity-
colored stacked columns of distinct ticket starts, and individual reported spans.
Line and column axes use integer ticket counts; the line is not normalized to
0–1. Peak sampling is explicitly labeled, and selecting a window inspects its
exact peak time. The SVG uses its measured pixel width and the user's inherited
font size instead of stretching text with a fixed viewBox.

Solid spans stop at the actual reported range end. Point incidents use a dot and
an optional dashed continuation to the current time (including closed tickets);
this is a visualization, not a verified incident duration. Users can select
reported moments only. The chart previews three priority-sorted ticket lanes;
Explore tickets contains full metadata, up to 50 spans and ranked windows.
Invalid/missing incident times are reported separately. Theme/width/font changes
redraw the chart locally. Date, type, department, severity and concurrency filters
also run locally, without loading media or adding per-filter API requests.
The visible dashboard refreshes its existing record bundle every 60 seconds.

The compact layout combines status, handling metrics and recent tickets into one
overview. Secondary analysis has a three-column classification row plus two
side-by-side switchable widgets (department/priority distribution and open-ticket
age/resolution time). Tab choices persist per user; existing admin/user widget
visibility remains authoritative. The old Feedback activity widget is removed.


`hpham` (`mes-owner`) remains the sole Owner. Owner assigns admin/user roles in
User directory → Edit account. Role changes revoke existing sessions. Admins
manage default dashboard widgets; account management, publishing, host storage
and Wi-Fi remain Owner-only. Saved personal widget layouts take precedence over
workspace defaults; users can reset to administrator defaults. Existing layouts
and all ticket records are retained during the additive migration.

Settings → Links and network drives configures content tabs. Link widgets support
HTTP(S) intranet services, relative site links and copyable UNC/drive/file paths.
Drive paths never become executable hyperlinks, and the server never fetches
these addresses. Local services need LAN/VPN access and their own authentication.

### Owner Wi-Fi controls on Raspberry Pi

The installer enables `th-wifi.service`, a root broker reachable only through a
Unix socket owned by `thapp`. Owner-only same-origin API routes expose its fixed
status/connect/confirm operations. The Node application retains its unprivileged
service identity. Other platforms hide Wi-Fi controls.

Only NetworkManager-managed Raspberry Pi Wi-Fi supports changing SSID and WPA2/
WPA3 Personal credentials (DHCP). NetworkManager checkpoints restore the prior
connection and delete the unconfirmed new profile after 120 seconds, even if the
application disconnects. Reopen Settings → Raspberry Pi Wi-Fi and confirm the
new active connection within that period to persist it. Wi-Fi passwords never
appear in process arguments or application logs; profile files are root-only.
Deployment only installs this capability; it does not change the current Wi-Fi.
Unsupported hosts/controllers report the feature unavailable. Physical network
switch/rollback still needs a supervised device test; automated tests mock
NetworkManager to avoid disrupting the production connection.
