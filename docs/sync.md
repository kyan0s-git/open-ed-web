# How sync works

Sync keeps `progress.json` the same on every device you connect. Course archives are not
synced: they are large, and you can download them again from OCW at any time. Each device
imports the courses it needs. Because a course is identified by OCW's own id, its progress
finds it on every device.

## What the server knows

Nothing that identifies you, and nothing it can read.

There are no accounts. The first device creates a random 256-bit **secret**, and every
other device gets it through a sync link. From the secret, each device derives three
values with HKDF-SHA-256:

| Derived value | Who sees it | Used for |
| --- | --- | --- |
| Vault id (128 bits) | Server | The address of the vault: `/api/v1/vaults/<id>` |
| Access token (256 bits) | Server, as a SHA-256 hash only | `Authorization: Bearer …` on every request |
| Encryption key (AES-256-GCM) | Never leaves the device | Encrypting progress before upload |

The server stores, per vault: the id, the hash of the access token, a version number, a
timestamp, and the ciphertext. Whoever runs the server cannot decrypt the progress,
cannot tell which person it belongs to, and cannot forge an update that devices would
accept. Decryption would fail, because the vault id is bound into the authentication tag.

The secret travels in the link's fragment, the part after `#`:
`https://your.site/pair#k=<secret>`. Browsers never send the fragment to a server, so
opening the link reveals nothing to the site that serves the page. The app removes it
from the address bar as soon as it has read it.

**Treat a sync link like a password.** Anyone who has it can read and change the
progress in that vault. If one leaks, delete the vault (Settings → Stop syncing → Delete
synced data from the server) and turn sync on again to get a new secret.

## The sync loop

A device syncs when it starts, a few seconds after you finish something, when you return
to the app, when it comes back online, and every five minutes while it is open. Each sync:

1. **Reads** the vault, sending the version it last saw (`If-None-Match`). If nothing has
   changed on either side, that is the whole sync: one small request, with no data
   transferred.
2. **Merges** the vault into the local progress record by record. This is the same merge
   as importing a progress file:
   - pages, skills and notes: the more recently updated record wins;
   - quiz attempts: the union of both logs, capped at the 500 most recent per course;
   - daily activity: the larger count per day, so a day spent on two devices still
     counts once.
3. **Writes** the result back, but only if the vault was missing something, and only if
   it is still at the version that was read (`If-Match`). If another device wrote in
   between, the server answers `412 Precondition Failed` and the device starts again
   from step 1. Nothing is lost either way, because every write is a merge.

Every device keeps a full copy of its progress, so the server is a meeting point, not the
source of truth. It can be offline, wiped, or replaced, and the devices carry on. Point
them at a new server by turning sync off and on again.

### Things to know

- Timestamps come from each device's clock. If a clock is far off, that device's
  changes may win or lose ties they should not.
- Nothing is ever deleted by sync. The app has no "forget this progress" action, so this
  rarely matters. If you remove a course, its progress is kept, and it comes back when you
  re-import the course.
- A vault is limited to 1 MB by default. Progress for several heavily used courses
  compresses to well under 100 KB.

## The course library

The progress file also carries the learner's **library**: for each course, its title,
number, size, and the address its archive can be downloaded from. For OCW courses, that
is `https://ocw.mit.edu/<site_url_path>/<site_short_id>.zip`, built from fields every OCW
archive carries. OCW serves these with `Access-Control-Allow-Origin: *` and byte ranges, so
browsers and the desktop app download directly from MIT, resuming interrupted downloads
with `Range` and `If-Range`.

So the server stores the list, encrypted with everything else, and never a course.
Library entries merge like other records (newest wins). Removing a course from the
library records the removal, so it reaches every device instead of being undone by the
next merge. Removing it from one device only is remembered on that device, so automatic
downloads leave it alone.

After a download, the app checks the course's OCW id matches the library entry. If the
address now holds a different course, it keeps the download but stops retrying.

## The API

Every host adapter implements the same small HTTP API (`server/core.ts`):

| Request | Result |
| --- | --- |
| `GET /api/v1/health` | `{"ok":true,"service":"open-ed-web-sync","protocol":1,"maxBytes":…}` |
| `GET /api/v1/vaults/:id` | `200` with the blob and an `ETag`, `304` if unchanged, `404` if no such vault |
| `PUT /api/v1/vaults/:id` + `If-None-Match: *` | Create. `201`, or `412` if it exists |
| `PUT /api/v1/vaults/:id` + `If-Match: "<n>"` | Replace. `200` with the new `ETag`, or `412` if the vault moved on |
| `DELETE /api/v1/vaults/:id` | `204` |

Vault requests need `Authorization: Bearer <token>`. The first `PUT` records the token's
hash, and later requests with another token get `403`. CORS is open by default
(`SYNC_ALLOWED_ORIGINS`), which is safe because nothing relies on cookies.

The blob format, so other clients can interoperate: `"OEW"`, a format byte (`1`), a flags
byte (bit 0: gzip), a 12-byte IV, then the AES-GCM ciphertext of the pretty-printed
`progress.json` (gzipped if flagged). The associated data is the 5-byte header followed
by the vault id as ASCII. HKDF uses the salt `open-ed-web/sync/v1` and the info strings
`vault-id`, `access-token` and `encryption-key`. See `src/sync/crypto.ts`.
