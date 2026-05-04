# AutoStaple

> Pick a Drive folder → mail every printable file to a print-by-email service → auto-collect the release codes from your inbox.

A Google Apps Script web app that turns "I have 40 PDFs in a folder I need to print at Staples" into one click. It scans a Drive folder, shows you every printable file, batches them under Gmail's 25 MB cap, sends them to the print service's email address, and then watches your inbox for release-code replies (`Release code BBB00450 is ready for printing`) and lets you export them to CSV.

No backend, no install, no GCP project setup — pure Apps Script.

---

## Features

- **Inline Drive folder picker** with breadcrumbs and click-to-enter — no Google Picker API key required.
- **Smart file detection** — PDF, JPG/PNG/TIFF/HEIC/etc., DOCX/XLSX/PPTX, RTF, TXT, plus Google Docs/Sheets/Slides/Drawings auto-exported to PDF.
- **25 MB-aware batching** — splits attachments across multiple emails so each fits under Gmail's per-message cap; subjects auto-suffixed `(1/N)`.
- **Release-code harvesting** — searches Gmail for replies from Staples / PrintMe, parses both `Subject: Release code <X> is ready` and body lines like `Release code: <X>`, dedups by message+code, click-to-copy, ✓ to redeem, ⬇ to export CSV.
- **Send-time cutoff** — only codes received *after* you clicked Send are surfaced; old/unrelated mail is filtered out.
- **Optional auto-collect trigger** — installs a 15-minute time trigger that scans for new codes in the background.
- **Persistent defaults** — last folder, recipient, subject, body remembered per user.

---

## Quick start

```
1. New Apps Script project        →  https://script.google.com
2. Project Settings → enable      →  "Show 'appsscript.json' manifest file"
3. Paste the 3 files from this    →  appsscript.json, Code.gs, Index.html
   repo into the editor
4. Deploy → New deployment        →  type: Web app, execute as: Me
5. Authorize (Advanced → unsafe)  →  it's "unverified" only because it's
                                     your private project
6. Bookmark the Web app URL
```

That's it. Detailed steps below if you'd rather click through them.

---

## Detailed setup

### 1. Create the Apps Script project

1. Go to <https://script.google.com> → **New project**.
2. Rename it `AutoStaple`.
3. Open **Project Settings** (gear icon in the left rail) → enable **Show "appsscript.json" manifest file in editor**.
4. Back in the editor, paste this repo's files into the matching ones:

   | This repo file       | Apps Script file       | How to add                                                        |
   |----------------------|------------------------|-------------------------------------------------------------------|
   | `appsscript.json`    | `appsscript.json`      | Already exists once manifest is shown — replace contents.         |
   | `Code.gs`            | `Code.gs`              | Already exists by default — replace contents.                     |
   | `Index.html`         | `Index.html`           | **+ → HTML** → name it `Index` (no extension), paste body.        |

5. **Save** (Ctrl+S).

### 2. Deploy as a web app

1. Top right → **Deploy → New deployment**.
2. Click the gear → **Web app**.
3. Settings:
   - **Description**: `AutoStaple v1`
   - **Execute as**: **Me** (your account)
   - **Who has access**: **Only myself** (or **Anyone with Google account** for shared use)
4. **Deploy** → **Authorize access** → pick your Google account → on the unverified-app screen click **Advanced → Go to AutoStaple (unsafe)** → **Allow**.
5. Copy the **Web app URL** and bookmark it.

### 3. Use it

1. Open the web app URL.
2. **Pick a folder** — click `📁 Browse Drive` to navigate inline (breadcrumbs, click-to-enter, **Select this folder** to confirm), or paste a Drive folder URL/ID directly. Tick **Include sub-folders** if you want recursion.
3. **Review files** — every printable file appears with size + extension badge. Untick anything you don't want.
4. **Send to printer** — enter the print service's email, edit subject/body if needed, click **Send to printer** → confirm.
5. **Collect codes** — after the service replies, scroll to step 4:
   - **↻ Collect now** for an immediate scan, or
   - **Auto-collect every 15 min** to install a background trigger.
   - Click any code to copy it. Use ✓ to mark redeemed (strike-through), × to delete one, **⬇ Export CSV** to download all.

---

## How it works

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐
│  HtmlService    │←→  │  Code.gs         │←→  │ Drive · Gmail · Mail  │
│  Index.html UI  │    │  (server logic)  │    │     (Google APIs)     │
└─────────────────┘    └──────────────────┘    └───────────────────────┘
        ↑                       │                        │
        │                       ├── DriveApp.getFolderById → walk → classify
        │                       ├── UrlFetchApp.fetch /export → PDF blobs
        │                       ├── MailApp.sendEmail({attachments})  ←── 25 MB chunked
        │                       ├── GmailApp.search('from:... after:<sendTime>')
        │                       └── PropertiesService (defaults, codes, cutoff, query)
        │
        └── google.script.run.* RPCs
```

- **Folder browser** — `DriveApp.getFolderById(id).getFolders()` lists immediate sub-folders; breadcrumbs walk `getParents()` up to root.
- **Native exports** — Google Docs/Sheets/Slides/Drawings hit `https://www.googleapis.com/drive/v3/files/<id>/export?mimeType=application/pdf` with `Authorization: Bearer ScriptApp.getOAuthToken()`.
- **Batching** — blobs are bin-packed greedily under 24 MB (1 MB headroom under Gmail's 25 MB cap); each batch sends as a separate `MailApp.sendEmail` with subject suffix `(i/N)`.
- **Code harvesting** — Gmail search runs with `after:<firstSendAtUnix>` so only post-send mail is considered; the regex pair below extracts codes from subjects and from body lines that start with `Release code:`.

```js
const SUBJECT_CODE_REGEX   = /Release\s+code\s+([A-Z0-9]{4,20})\b/i;
const BODY_LINE_CODE_REGEX = /^[\s>*\-]*Release\s*code\s*[:\-]\s*([A-Z0-9]{4,20})\b/gim;
```

A belt-and-suspenders `isLikelyCode_` check requires every match to mix letters and digits (so words like `WILL` don't sneak through).

---

## Print service emails

Email-to-print addresses change — confirm the current one on your provider's site before relying on this:

- **Staples / PrintMe** — Staples retail kiosks use the PrintMe network; replies come from `no-reply@printme.com` with the release code in the subject. Look up the current submission address via the Staples printing page or your kiosk receipt.
- **FedEx Office** — uses a web upload portal (`fedex.com/printonline`), not email-in. AutoStaple won't help there.
- **Local shops** — most independent print shops accept `print@<shopname>.com`. Ask.

**Tip:** test with `recipient = your own email` first to verify attachments arrive intact.

---

## OAuth scopes

Declared in `appsscript.json`:

| Scope                          | Why                                                                 |
|--------------------------------|---------------------------------------------------------------------|
| `drive.readonly`               | List folders, read file metadata + bytes, export Google-native      |
| `script.send_mail`             | Send email via `MailApp` from your Gmail account                    |
| `script.external_request`      | Call Drive REST `/export` endpoint with your OAuth token            |
| `script.scriptapp`             | Install the optional 15-min auto-collect time trigger               |
| `gmail.readonly`               | Search inbox for `from:staples.com OR printme.com "release code"`   |
| `userinfo.email`               | Show your email in the UI / set as `replyTo`                        |

The app cannot delete or modify any mail (`gmail.readonly` is read-only). Sends use `script.send_mail` separately. No data leaves your Google account except the email you explicitly send.

---

## Quotas

| Limit                       | Consumer Gmail | Workspace |
|-----------------------------|----------------|-----------|
| Emails / day (Apps Script)  | 100            | 1500      |
| Recipients / message        | 100            | 100       |
| Attachment size / message   | 25 MB          | 25 MB     |
| `UrlFetchApp` / day         | 20,000         | 100,000   |

A single file over 25 MB throws an error before send — compress or split it first.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Folder not found or access denied` | Sign in as the folder owner, or have it shared with you. |
| `Export failed` | Transient Drive hiccup — retry. Shared-drive files may need broader sharing. |
| `File X is N MB — over the 25 MB email cap` | Compress, split, or use the service's web portal for that one file. |
| No email arrives at the printer | Check Gmail **Sent** — if it's there, the issue is on the printer side (wrong address, account not linked). |
| `Specified permissions are not sufficient` | New scope was added; force re-auth by running any function once from the editor (▶ Run on `getUserEmail` or `collectReleaseCodes`), then redeploy: **Deploy → Manage deployments → ✏ → New version → Deploy**. |
| Garbage codes like `WILL` appear | Already filtered — regex requires line-start `Release code:` in body and a letter+digit mix. Click **Clear all → Collect now** to re-scan with the current filter. |
| Codes appear that are unrelated to your print job | Click **reset** next to the cutoff line to re-baseline; future Collects will only see mail received after your next Send. |

---

## Files

```
appsscript.json   manifest + OAuth scopes
Code.gs           server-side Apps Script (Drive walk, mail send, code parser, triggers)
Index.html        web app UI — folder picker, file list, send form, codes panel
README.md         this file
```

---

## License

MIT — do whatever, no warranty.
