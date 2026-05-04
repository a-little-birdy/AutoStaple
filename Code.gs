/**
 * AutoStaple — pick a Drive folder, review printable files, email them
 * to a print-by-email service (e.g. Staples, FedEx, local print shop).
 *
 * Web app entry: doGet -> Index.html
 */

const PRINTABLE_EXTENSIONS = new Set([
  'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff', 'bmp', 'webp', 'heic',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'odt', 'ods', 'odp', 'rtf', 'txt'
]);

// Google-native types that must be exported before mailing.
const GOOGLE_NATIVE_EXPORT = {
  'application/vnd.google-apps.document':     'application/pdf',
  'application/vnd.google-apps.spreadsheet':  'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing':      'application/pdf'
};

// Gmail caps a single message at 25 MB. Stay under it.
const MAX_BATCH_BYTES = 24 * 1024 * 1024;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('AutoStaple')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getUserEmail() {
  return Session.getActiveUser().getEmail();
}

/**
 * Accepts a Drive folder URL or raw ID and returns the ID.
 */
function extractFolderId(input) {
  if (!input) throw new Error('Folder URL or ID is required.');
  const trimmed = String(input).trim();
  const match = trimmed.match(/[-\w]{25,}/);
  if (!match) throw new Error('Could not find a folder ID in: ' + trimmed);
  return match[0];
}

/**
 * Walk the folder (optionally recursive) and return printable files.
 */
function listPrintable(folderInput, recursive) {
  const id = extractFolderId(folderInput);
  let folder;
  try {
    folder = DriveApp.getFolderById(id);
  } catch (e) {
    throw new Error('Folder not found or access denied: ' + id);
  }

  const out = [];
  walk_(folder, '', !!recursive, out);
  out.sort(function (a, b) { return a.path.localeCompare(b.path); });

  return {
    folderName: folder.getName(),
    folderId: id,
    files: out,
    totalBytes: out.reduce(function (s, f) { return s + f.size; }, 0)
  };
}

function walk_(folder, prefix, recursive, out) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const info = classify_(f, prefix);
    if (info) out.push(info);
  }
  if (!recursive) return;
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const s = subs.next();
    walk_(s, prefix + s.getName() + '/', recursive, out);
  }
}

function classify_(file, prefix) {
  const name = file.getName();
  const mime = file.getMimeType();
  const size = file.getSize();
  const id = file.getId();
  const path = prefix + name;

  if (GOOGLE_NATIVE_EXPORT[mime]) {
    return {
      id: id,
      name: name + '.pdf',
      path: prefix + name + '.pdf',
      size: size, // approx — true PDF size known only after export
      mime: GOOGLE_NATIVE_EXPORT[mime],
      sourceMime: mime,
      exported: true
    };
  }
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (PRINTABLE_EXTENSIONS.has(ext)) {
    return {
      id: id,
      name: name,
      path: path,
      size: size,
      mime: mime,
      sourceMime: mime,
      exported: false
    };
  }
  return null; // skip non-printable (videos, archives, code, etc.)
}

/**
 * Build blobs for the chosen files, batch them under the 25 MB cap,
 * and send one email per batch.
 */
function sendToStaples(payload) {
  if (!payload) throw new Error('Missing payload.');
  const recipient = (payload.recipient || '').trim();
  const fileIds = payload.fileIds || [];
  const subject = (payload.subject || 'Print job').trim();
  const body = payload.body || 'Please print the attached files.';

  if (!recipient) throw new Error('Recipient email is required.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
    throw new Error('Recipient does not look like an email address: ' + recipient);
  }
  if (!fileIds.length) throw new Error('No files selected.');

  const blobs = fileIds.map(buildBlob_);
  const batches = chunkBlobs_(blobs, MAX_BATCH_BYTES);
  const me = Session.getActiveUser().getEmail();
  const summary = [];

  batches.forEach(function (batch, i) {
    const subj = batches.length > 1
      ? subject + ' (' + (i + 1) + '/' + batches.length + ')'
      : subject;

    MailApp.sendEmail({
      to: recipient,
      subject: subj,
      body: body,
      attachments: batch,
      name: 'AutoStaple',
      replyTo: me
    });

    summary.push({
      batch: i + 1,
      count: batch.length,
      bytes: batch.reduce(function (s, b) { return s + b.getBytes().length; }, 0),
      files: batch.map(function (b) { return b.getName(); })
    });
  });

  // Persist last-used recipient/subject/body for next run.
  saveDefaults({ recipient: recipient, subject: subject, body: body });

  // Stamp send time — codes received before the first send are filtered out.
  const props = PropertiesService.getUserProperties();
  const nowSec = Math.floor(Date.now() / 1000);
  if (!props.getProperty('firstSendAt')) {
    props.setProperty('firstSendAt', String(nowSec));
  }
  props.setProperty('lastSendAt', String(nowSec));

  return {
    sent: true,
    recipient: recipient,
    batches: summary,
    totalFiles: fileIds.length
  };
}

function buildBlob_(fileId) {
  const f = DriveApp.getFileById(fileId);
  const mime = f.getMimeType();
  if (GOOGLE_NATIVE_EXPORT[mime]) {
    const blob = exportNative_(fileId, GOOGLE_NATIVE_EXPORT[mime]);
    blob.setName(f.getName() + '.pdf');
    return blob;
  }
  return f.getBlob().setName(f.getName());
}

function exportNative_(fileId, mimeType) {
  const url = 'https://www.googleapis.com/drive/v3/files/' + fileId +
              '/export?mimeType=' + encodeURIComponent(mimeType);
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Export failed for file ' + fileId + ': ' + resp.getContentText());
  }
  return resp.getBlob();
}

function chunkBlobs_(blobs, maxBytes) {
  const batches = [];
  let cur = [];
  let curSize = 0;
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const s = b.getBytes().length;
    if (s > maxBytes) {
      throw new Error('File "' + b.getName() + '" is ' +
        (s / 1048576).toFixed(1) + ' MB — over the 25 MB email cap. ' +
        'Compress or split it before sending.');
    }
    if (curSize + s > maxBytes && cur.length) {
      batches.push(cur);
      cur = [];
      curSize = 0;
    }
    cur.push(b);
    curSize += s;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/**
 * Folder browser — list immediate sub-folders of a given folder.
 * parentId === null/empty/'root' starts at My Drive root.
 */
function listFolders(parentId) {
  const folder = (!parentId || parentId === 'root')
    ? DriveApp.getRootFolder()
    : DriveApp.getFolderById(parentId);

  const out = [];
  const it = folder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    out.push({ id: f.getId(), name: f.getName() });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });

  return {
    id: folder.getId(),
    name: folder.getName(),
    isRoot: (folder.getId() === DriveApp.getRootFolder().getId()),
    folders: out
  };
}

/**
 * Build a breadcrumb chain from root to the given folder.
 * Returns [{id,name}, ...] starting at My Drive.
 */
function getFolderPath(folderId) {
  if (!folderId || folderId === 'root') {
    const r = DriveApp.getRootFolder();
    return [{ id: r.getId(), name: r.getName() }];
  }
  let cur = DriveApp.getFolderById(folderId);
  const rootId = DriveApp.getRootFolder().getId();
  const chain = [{ id: cur.getId(), name: cur.getName() }];
  let guard = 0;
  while (cur.getId() !== rootId && guard++ < 50) {
    const parents = cur.getParents();
    if (!parents.hasNext()) break; // shared folder w/ no visible parent
    cur = parents.next();
    chain.unshift({ id: cur.getId(), name: cur.getName() });
  }
  return chain;
}

function getDefaults() {
  const props = PropertiesService.getUserProperties();
  return {
    recipient: props.getProperty('recipient') || '',
    subject:   props.getProperty('subject')   || 'Print job',
    body:      props.getProperty('body')      || 'Please print the attached files.',
    folder:    props.getProperty('folder')    || ''
  };
}

function saveDefaults(payload) {
  const props = PropertiesService.getUserProperties();
  ['recipient', 'subject', 'body', 'folder'].forEach(function (k) {
    if (payload[k] != null) props.setProperty(k, String(payload[k]));
  });
  return getDefaults();
}

/* ------------------------------------------------------------------ *
 *  Release-code collection
 *
 *  Staples (and most email-print providers) reply with a line like:
 *      Release code: ABF12F12
 *  We search Gmail for those replies, parse the codes, dedup by
 *  (messageId, code), and persist them in user properties.
 * ------------------------------------------------------------------ */

const STAPLES_QUERY_DEFAULT =
  'from:(staples.com OR stapleslocker.com OR stapleseasy.com OR printme.com) "release code" newer_than:90d';
// Subject form (e.g. printme.com): "Release code BBB00450 is ready for printing"
const SUBJECT_CODE_REGEX = /Release\s+code\s+([A-Z0-9]{4,20})\b/i;

// Body form: a line that starts with "Release code:" — reject prose like
// "Your release code WILL expire..." by anchoring to line start and
// requiring a colon (or dash) separator.
const BODY_LINE_CODE_REGEX = /^[\s>*\-]*Release\s*code\s*[:\-]\s*([A-Z0-9]{4,20})\b/gim;

// Belt-and-suspenders: real codes always mix letters AND digits.
function isLikelyCode_(s) {
  return /[A-Z]/.test(s) && /[0-9]/.test(s);
}

function extractCodes_(subject, body) {
  const out = new Set();
  const sm = (subject || '').match(SUBJECT_CODE_REGEX);
  if (sm && isLikelyCode_(sm[1])) out.add(sm[1].toUpperCase());
  const bm = (body || '').matchAll(BODY_LINE_CODE_REGEX);
  for (const m of bm) {
    if (isLikelyCode_(m[1])) out.add(m[1].toUpperCase());
  }
  return Array.from(out);
}
const CODES_PROP_KEY = 'codes';
const CODES_QUERY_KEY = 'codesQuery';
const TRIGGER_FN = 'collectReleaseCodes';

function getStoredCodes_() {
  const raw = PropertiesService.getUserProperties().getProperty(CODES_PROP_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function setStoredCodes_(arr) {
  PropertiesService.getUserProperties().setProperty(CODES_PROP_KEY, JSON.stringify(arr));
}

function getCodesQuery() {
  return PropertiesService.getUserProperties().getProperty(CODES_QUERY_KEY) || STAPLES_QUERY_DEFAULT;
}

function setCodesQuery(q) {
  const v = (q && String(q).trim()) || STAPLES_QUERY_DEFAULT;
  PropertiesService.getUserProperties().setProperty(CODES_QUERY_KEY, v);
  return v;
}

/**
 * Search Gmail for print-service replies, parse "Release code: <X>",
 * dedup against stored, persist new ones. Safe to call repeatedly.
 */
function collectReleaseCodes() {
  const props = PropertiesService.getUserProperties();
  const firstSendAt = parseInt(props.getProperty('firstSendAt') || '0', 10);
  let query = getCodesQuery();

  // Tighten Gmail-side window to "since first send". Strip any existing
  // newer_than: clause from the user's saved query so it doesn't fight us.
  if (firstSendAt) {
    query = query.replace(/\bnewer_than:\S+/gi, '').replace(/\bafter:\S+/gi, '').trim();
    query += ' after:' + firstSendAt;
  }

  const threads = GmailApp.search(query, 0, 100);
  const existing = getStoredCodes_();
  const seen = new Set(existing.map(function (c) { return c.messageId + '::' + c.code; }));
  const additions = [];
  const cutoffMs = firstSendAt * 1000;

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      // Belt-and-suspenders: even if Gmail returns older messages in a
      // thread that started before the cutoff, ignore them client-side.
      if (cutoffMs && msg.getDate().getTime() < cutoffMs) return;
      const subject = msg.getSubject() || '';
      const body = msg.getPlainBody() || '';
      const codes = extractCodes_(subject, body);
      for (const code of codes) {
        const key = msg.getId() + '::' + code;
        if (seen.has(key)) continue;
        seen.add(key);
        additions.push({
          code: code,
          messageId: msg.getId(),
          threadId: thread.getId(),
          receivedAt: msg.getDate().toISOString(),
          sender: msg.getFrom(),
          subject: subject,
          redeemed: false
        });
      }
    });
  });

  let merged = existing;
  if (additions.length) {
    merged = additions.concat(existing);
    // newest first
    merged.sort(function (a, b) {
      return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
    });
    setStoredCodes_(merged);
  }

  return {
    newCount: additions.length,
    totalCount: merged.length,
    codes: merged,
    query: query,
    scannedThreads: threads.length,
    cutoff: firstSendAt ? new Date(cutoffMs).toISOString() : null
  };
}

function getCutoff() {
  const v = parseInt(PropertiesService.getUserProperties().getProperty('firstSendAt') || '0', 10);
  return v ? new Date(v * 1000).toISOString() : null;
}

function resetCutoff() {
  const props = PropertiesService.getUserProperties();
  props.deleteProperty('firstSendAt');
  props.deleteProperty('lastSendAt');
  return null;
}

function getCodes() {
  return {
    codes: getStoredCodes_(),
    query: getCodesQuery(),
    autoCollect: getAutoCollectStatus(),
    cutoff: getCutoff()
  };
}

function markRedeemed(messageId, code, redeemed) {
  const codes = getStoredCodes_();
  const i = codes.findIndex(function (c) { return c.messageId === messageId && c.code === code; });
  if (i >= 0) {
    codes[i].redeemed = !!redeemed;
    setStoredCodes_(codes);
  }
  return codes;
}

function deleteCode(messageId, code) {
  const codes = getStoredCodes_().filter(function (c) {
    return !(c.messageId === messageId && c.code === code);
  });
  setStoredCodes_(codes);
  return codes;
}

function clearCodes() {
  setStoredCodes_([]);
  return [];
}

/**
 * Build a CSV string of all stored codes for client-side download.
 */
function exportCodesCsv() {
  const codes = getStoredCodes_();
  const header = ['code', 'received_at', 'sender', 'subject', 'redeemed', 'message_id'];
  const esc = function (s) {
    return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  };
  const rows = codes.map(function (c) {
    return [c.code, c.receivedAt, c.sender, c.subject, c.redeemed, c.messageId].map(esc).join(',');
  });
  return [header.map(esc).join(',')].concat(rows).join('\n');
}

function getAutoCollectStatus() {
  const triggers = ScriptApp.getProjectTriggers();
  return triggers.some(function (t) { return t.getHandlerFunction() === TRIGGER_FN; });
}

function setAutoCollect(enabled) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === TRIGGER_FN) ScriptApp.deleteTrigger(t);
  });
  if (enabled) {
    ScriptApp.newTrigger(TRIGGER_FN).timeBased().everyMinutes(15).create();
  }
  return getAutoCollectStatus();
}
