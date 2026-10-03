/**
 * Nexus 2.0 — Mail sender (Google Apps Script web app).
 * Nexus never talks to this directly from the browser: only the Supabase edge function "nx-mail" calls it,
 * with a shared secret. The secret is kept in Script Properties, never in this code.
 *
 * Setup (once):
 *  1. script.google.com → New project → paste this file → Save.
 *  2. Project Settings → Script Properties → Add:  NEXUS_MAIL_SECRET = <a long random text>
 *     (optional) NEXUS_MAIL_NAME = Zooto Nexus                  (sender name when a mail does not bring its own)
 *     (optional) NEXUS_MAIL_REPLY_TO = purchase@yourcompany.com  (replies go here when a mail does not bring its own)
 *  3. Run "testSetup" once from the editor and allow the Gmail permission.
 *  4. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy → copy the /exec URL.
 *  5. Supabase → Edge Functions → Secrets: GAS_MAIL_URL = that /exec URL, GAS_MAIL_SECRET = the same secret text.
 * After changing this code: Deploy → Manage deployments → Edit → Version: New version (the URL stays the same).
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var secret = PropertiesService.getScriptProperties().getProperty('NEXUS_MAIL_SECRET');
    if (!secret || !safeEqual_(String(p.secret || ''), secret)) return json_({ ok: false, error: 'Not allowed' });

    var to = cleanList_(p.to), cc = cleanList_(p.cc);
    if (!to) return json_({ ok: false, error: 'No valid recipient' });
    var subject = String(p.subject || 'Nexus').replace(/[\r\n]+/g, ' ').slice(0, 250);
    var body = String(p.body || '').slice(0, 20000);
    if (MailApp.getRemainingDailyQuota() < 1) return json_({ ok: false, error: 'Daily Gmail quota used up' });

    // every mail brings its own sender name / no-reply / reply-to / from (Nexus decides per mail type)
    var props = PropertiesService.getScriptProperties();
    var opts = {
      name: String(p.name || props.getProperty('NEXUS_MAIL_NAME') || 'Zooto Nexus').slice(0, 80),
      htmlBody: toHtml_(body)
    };
    if (cc) opts.cc = cc;
    var replyTo = cleanList_(p.replyTo || props.getProperty('NEXUS_MAIL_REPLY_TO') || '');
    if (replyTo) opts.replyTo = replyTo;
    var att = (p.attachments || []).slice(0, 3).map(function (a) {
      return Utilities.newBlob(Utilities.base64Decode(String(a.data || '')), String(a.mime || 'application/pdf'), String(a.name || 'Nexus.pdf'));
    });
    if (att.length) opts.attachments = att;

    // "from" works only when that address is set up as a Send-mail-as alias of this Gmail account
    var from = cleanList_(p.from || ''), useAlias = false;
    if (from) { try { useAlias = (GmailApp.getAliases() || []).map(function (a) { return String(a).toLowerCase(); }).indexOf(from.toLowerCase()) > -1; } catch (x) { } }

    lock.waitLock(20000);
    if (useAlias) {
      opts.from = from;
      GmailApp.sendEmail(to, subject, body, opts);
    } else {
      if (p.noReply === true) opts.noReply = true;   // no-reply sender (Google Workspace accounts only)
      try { MailApp.sendEmail(to, subject, body, opts); }
      catch (eNr) { if (!opts.noReply) throw eNr; delete opts.noReply; MailApp.sendEmail(to, subject, body, opts); }
    }
    log_([new Date(), to, cc, subject, String(p.ref || ''), 'sent', '']);
    return json_({ ok: true });
  } catch (err) {
    log_([new Date(), '', '', '', '', 'failed', String(err && err.message || err)]);
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { }
  }
}

function doGet() { return json_({ ok: true, service: 'Nexus mail' }); }

// every mail is written to a "Nexus Mail Log" sheet in the owner's Drive (Date & Time, To, CC, Subject, Ref, Status, Error)
function log_(row) {
  try {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('NEXUS_MAIL_LOG_ID'), ss = null;
    if (id) { try { ss = SpreadsheetApp.openById(id); } catch (x) { ss = null; } }
    if (!ss) {
      ss = SpreadsheetApp.create('Nexus Mail Log');
      ss.getSheets()[0].appendRow(['Date & Time', 'To', 'CC', 'Subject', 'Ref', 'Status', 'Error']);
      props.setProperty('NEXUS_MAIL_LOG_ID', ss.getId());
    }
    ss.getSheets()[0].appendRow(row);
  } catch (x) { /* logging must never stop a mail */ }
}

function cleanList_(s) {
  return String(s || '').split(/[,;\s]+/).map(function (x) { return x.trim(); })
    .filter(function (x) { return /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/.test(x); }).slice(0, 20).join(',');
}
function toHtml_(text) {
  var esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;white-space:pre-wrap">' + esc + '</div>' +
    '<div style="font-family:Arial,sans-serif;font-size:11px;color:#888;margin-top:16px">Sent by Zooto Nexus</div>';
}
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Run once from the editor: asks for the Gmail permission and mails you a test.
function testSetup() {
  if (!PropertiesService.getScriptProperties().getProperty('NEXUS_MAIL_SECRET')) throw new Error('Add NEXUS_MAIL_SECRET in Project Settings → Script Properties first.');
  var me = Session.getActiveUser().getEmail();
  MailApp.sendEmail(me, 'Nexus mail test', 'Nexus mail is working.', { name: 'Zooto Nexus' });
  try { Logger.log('Gmail aliases: ' + (GmailApp.getAliases() || []).join(', ')); } catch (x) { }
  log_([new Date(), me, '', 'Nexus mail test', 'setup', 'sent', '']);
  Logger.log('Test mail sent to ' + me + '. Quota left today: ' + MailApp.getRemainingDailyQuota());
}
