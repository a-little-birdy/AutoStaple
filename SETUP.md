# AutoStaple — Setup Guide

A Google Apps Script web app that scans a Drive folder for printable files
(PDF, images, Office docs, Google Docs/Sheets/Slides, text) and emails them
as attachments to a print-by-email service like Staples / FedEx / a local
print shop.

---

## What you get

- **Folder picker** — click **Browse Drive...** to navigate folders inline (breadcrumbs, click to enter, "Select this folder" to pick), or paste a Drive folder URL/ID directly. Optional recurse into sub-folders.
- **File preview** — every printable file with size + extension. Uncheck any you don't want.
- **Auto-export** — Google Docs / Sheets / Slides / Drawings export to PDF on the fly.
- **Smart batching** — splits attachments across multiple emails so each stays under Gmail's 25 MB cap.
- **Saved defaults** — remembers the recipient, subject, body, and last folder per user.
- **Auto release-code collection** — searches your Gmail for replies from Staples / PrintMe (`from:staples.com OR stapleslocker.com OR stapleseasy.com OR printme.com`), parses release codes from both subject (`Release code BBB00450 is ready for printing`) and body (`Release code: ABF12F12`), dedups them, lets you mark redeemed / export to CSV. Optional 15-min auto-collect trigger.

---

## 1. Create the Apps Script project (3 minutes)

1. Go to <https://script.google.com> → **New project**.
2. Rename it `AutoStaple`.
3. **Show manifest file:** click the gear icon (Project Settings) on the left rail, then enable **Show "appsscript.json" manifest file in editor**.
4. Back in the editor, you should now see `appsscript.json` in the file list. Open each of the four files in this repo and paste their contents into the corresponding file in the editor:

   | This repo file       | Apps Script file       | How to add                                    |
   |----------------------|------------------------|-----------------------------------------------|
   | `appsscript.json`    | `appsscript.json`      | Already exists once manifest is shown — replace contents. |
   | `Code.gs`            | `Code.gs`              | Already exists by default — replace contents. |
   | `Index.html`         | `Index.html`           | **+ → HTML** → name it `Index` (no extension), paste body. |

5. Click the **Save** (floppy) icon.

---

## 2. Deploy as a web app

1. Top right → **Deploy → New deployment**.
2. **Select type** (gear icon) → **Web app**.
3. Fill in:
   - **Description**: `AutoStaple v1`
   - **Execute as**: **Me** (your account)
   - **Who has access**: **Only myself** (or **Anyone with Google account** if multiple users will use it)
4. Click **Deploy**.
5. Click **Authorize access** → pick your Google account → on the "Google hasn't verified this app" screen, click **Advanced → Go to AutoStaple (unsafe)** → **Allow**. (It's only "unverified" because it's your private project. The scopes are listed in `appsscript.json` and reviewed below.)
6. Copy the **Web app URL** at the end. Bookmark it.

---

## 3. Use it

1. Open the bookmarked web app URL.
2. Pick a folder one of two ways:
   - Click **Browse Drive...** — modal opens at My Drive root. Click a folder name to enter it, breadcrumbs let you go back up. Click **Select this folder** to pick the folder you're currently viewing. Auto-scans on select.
   - Or paste a Drive folder URL / ID directly into the input — e.g. `https://drive.google.com/drive/folders/1AbC...`.
3. Optionally tick **Include sub-folders**.
4. Click **Scan folder**. Review the file list, untick anything you don't want printed.
5. Enter the print service's email address (see the **Print service emails** section below).
6. Edit subject/body if needed.
7. Click **Send to printer** → confirm. The app builds the attachments, batches them under 25 MB, and sends one or more emails from your Gmail.
8. After Staples replies (usually within seconds-to-minutes), scroll to **Step 4 — Release codes**:
   - Click **↻ Collect now** to scan your inbox immediately, or
   - Click **Auto-collect every 15 min** to install a time trigger that scans automatically.
   - Codes appear in the table. Click a code to copy it. Use ✓ to mark it redeemed (strike-through), × to delete, or **⬇ Export CSV** to download all codes.
   - Need a different sender? Open **Advanced: customize Gmail search query** and edit the search (Gmail search syntax: `from:`, `subject:`, `"quoted phrase"`, `newer_than:30d`, etc.).

---

## 4. Print service emails

Email-to-print addresses change. Confirm the current address and any account-link / authentication step on your provider's site **before relying on this**:

- **Staples** — historically `print@stapleslocker.com` for in-store locker pickup; newer Staples Connect / Print services may require an order through `staples.com/services/printing` instead. Check <https://www.staples.com/services/printing/> for the current path before sending real jobs.
- **FedEx Office** — uses an upload portal (`fedex.com/printonline`), not email-in. Skip this app for FedEx.
- **Local shops** — most independent print shops accept `print@<shopname>.com`. Ask.

**Tip:** send a one-page test job to yourself first (`recipient = your own email`) to verify the attachments arrive intact.

---

## 5. Quotas and limits

| Limit                       | Consumer Gmail | Workspace |
|-----------------------------|----------------|-----------|
| Emails / day (Apps Script)  | 100            | 1500      |
| Recipients / message        | 100            | 100       |
| Attachment size / message   | 25 MB          | 25 MB     |
| `UrlFetchApp` / day         | 20,000         | 100,000   |

The app already chunks attachments to stay under 25 MB per message. A single file over 25 MB will throw an error — compress or split it first.

---

## 6. OAuth scopes (what you're authorizing)

Defined in `appsscript.json`:

- `drive.readonly` — list folders, read file metadata + bytes, export Google-native files.
- `script.send_mail` — send the email via your Gmail account.
- `script.external_request` — call the Drive `export` endpoint with your OAuth token (needed for `.gdoc/.gsheet/.gslides` → PDF).
- `script.scriptapp` — install the optional 15-min auto-collect time trigger.
- `gmail.readonly` — search Gmail for replies that contain "Release code:" so codes can be auto-extracted. **Read-only** — the app cannot send mail or modify any messages with this scope (sends use `script.send_mail` separately).
- `userinfo.email` — show your email in the UI / set as `replyTo`.

No data leaves your Google account except the email you explicitly send.

---

## 7. Troubleshooting

- **"Folder not found or access denied"** — make sure you're signed in as the same account that owns the folder, or that the folder is shared with you.
- **"Export failed"** — usually a transient Drive API hiccup; retry. Files in shared drives sometimes need an extra share to "Anyone in your org".
- **"File X is N MB — over the 25 MB email cap"** — Gmail won't accept it as an attachment. Compress, split, or upload via the print service's web portal instead.
- **No email arrives** — check Gmail's **Sent** folder. If it's there, the issue is with the print service (wrong address, account not linked, etc.).
- **"Authorization required" in red bar** — re-run **Deploy → Manage deployments → edit → Deploy** to re-authorize, or run any function once from the editor (▶ button on `getUserEmail`) to trigger the consent screen.

---

## 8. Files in this repo

```
appsscript.json   manifest + OAuth scopes
Code.gs           server-side Apps Script
Index.html        web app UI (folder picker, file list, send form)
SETUP.md          this file
```

That's it. ~3 min to deploy, ~10 sec per print job after that.
