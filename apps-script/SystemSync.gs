// ============================================================
// L-TEX CRM | SystemSync.gs  ·  v1.0
// ------------------------------------------------------------
// СИСТЕМА → ТАБЛИЦЯ: зміни залучення, зроблені в нашій системі,
// автоматично переписують TG-блок рядка й лягають у журнал «_tg_log».
//
// НАВІЩО (рішення user 12.10)
//   «Наша система головна: якщо в ній змінили дані — їх треба змінювати
//   в Google-таблиці». Доти таблиця дізнавалась від системи лише про бота
//   (відкрив / підписався). Надсилання з картки, команда /тг у Viber,
//   ручні «🚫 Не потрібно», «❌ Відмовився», «👤 Приєднався» в таблицю не
//   потрапляли — і ранковий звіт таблиці їх не бачив.
//
// ЯК ПРАЦЮЄ
//   Система шле підписаний запит  ?a=tg&act=sys&id=<ID рядка>&ev=<подія>&at=<коли>
//   на ту саму адресу, що й події бота. Підпис рахується тим самим
//   секретом (TG_LINK_SECRET), тож підробити подію ззовні не вийде.
//
//   Події:
//     sent_first / sent_repeat — посилання надіслали (з картки, /тг);
//     bot_opened               — клієнт відкрив бота;
//     joined / joined_manual   — приєднався (бот побачив / менеджер позначив);
//     left / blocked           — відписався / заблокував бота;
//     not_needed / refused     — менеджер: «🚫 Не потрібно» / «❌ Відмовився».
//
// ДУБЛІВ НЕ ПЛОДИМО
//   Ту саму подію може принести і старий шлях бота, і цей. Тому:
//     · «приєднався» в журнал пишемо лише, якщо рядок ще не «👤 Приєднався»;
//     · «відкрив бота» — не частіше разу на 10 хв для того самого рядка;
//     · «надіслано вперше», якщо рядку вже колись надсилали з таблиці, —
//       пишемо як «повторно» (таблиця й так рахувала того «вперше»).
//
// ВСТАНОВЛЕННЯ
//   1. Додати цей файл у проєкт Apps Script.
//   2. У TelegramLink.gs → handleTgClick, поруч із рядком про tgEcoEvent_:
//        if (p.act === "sys" && typeof tgSysEvent_ === "function") return tgSysEvent_(p);
//      (у версії з репозиторію вже додано).
//   3. Опублікувати нову версію веб-застосунку (Deploy → Manage → Edit →
//      Version: New). Адреса не змінюється.
// ============================================================

var TG_STATUS_NOT_NEEDED = "🚫 Не потрібно";
var TG_STATUS_REFUSED    = "❌ Відмовився";
var TGS_SAME_MS          = 10 * 60 * 1000;   // «та сама подія», якщо ближче
var TGS_LOG_LOOKBACK     = 400;              // скільки останніх рядків журналу дивимось

var TGS_EVENTS = {
  sent_first: 1, sent_repeat: 1, bot_opened: 1, joined: 1, joined_manual: 1,
  left: 1, blocked: 1, not_needed: 1, refused: 1
};

function tgSysEvent_(p) {
  var out;
  try {
    var id = tgStr_(p.id), ev = tgStr_(p.ev), at = tgStr_(p.at);
    var secret = tgLinkSecret_();
    if (!secret) {
      out = {ok: false, error: "не задано TG_LINK_SECRET"};
    } else if (!id || !ev || !at || !TGS_EVENTS[ev]) {
      out = {ok: false, error: "потрібні id, ev, at"};
    } else if (tgStr_(p.sig) !== tgHmac12_("crm-lead-event", "sys|" + id + "|" + ev + "|" + at, secret)) {
      out = {ok: false, error: "підпис не збігається"};
    } else {
      out = {ok: true, applied: tgApplySysEvent_(id, ev, at, tgStr_(p.src))};
    }
  } catch (err) {
    Logger.log("tgSysEvent_: " + err);
    out = {ok: false, error: String(err)};
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// Людською мовою — звідки подія (у колонку «Джерело» журналу)
function tgsSourceLabel_(src) {
  var s = tgStr_(src);
  if (s.indexOf("card") === 0) return "система: картка";
  if (s === "viber_cmd") return "система: /тг";
  if (s === "bot" || s.indexOf("site") === 0) return "бот системи";
  return "система" + (s ? ": " + s : "");
}

// Чи був уже такий рядок журналу для цього ID нещодавно (за 10 хв)
function tgsRecentLog_(id, notePrefix, when) {
  try {
    var sh = tgSS_(MAIN_FILE_ID).getSheetByName(TG_LOG_SHEET);
    if (!sh) return false;
    var last = sh.getLastRow();
    if (last < 2) return false;
    var start = Math.max(2, last - TGS_LOG_LOOKBACK + 1);
    var vals = sh.getRange(start, 1, last - start + 1, 9).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (tgStr_(vals[i][1]) !== id) continue;
      if (tgStr_(vals[i][8]).toLowerCase().indexOf(notePrefix) !== 0) continue;
      var d = vals[i][0] instanceof Date ? vals[i][0] : null;
      if (d && Math.abs(d.getTime() - when.getTime()) <= TGS_SAME_MS) return true;
    }
  } catch (err) { Logger.log("tgsRecentLog_: " + err); }
  return false;
}

// Записує подію системи в рядок. Повертає коротке слово про те, що зробили.
function tgApplySysEvent_(id, ev, atIso, src) {
  var sheet = tgSheetForId_(id);
  if (!sheet) return "no-sheet";
  var row = tgFindRow_(sheet, COL.ID, DATA_START, id);
  if (row === -1) return "not-found";

  var when  = new Date(atIso);
  if (isNaN(when.getTime())) when = new Date();
  var stamp = Utilities.formatDate(when, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");
  var d     = sheet.getRange(row, 1, 1, TG_MAIN_LAST).getValues()[0];
  var cur   = tgStr_(d[TG_MAIN_STATUS - 1]);
  var ours  = tgEcoStatusIsOurs_(cur);
  var hadSent = Boolean(tgStr_(d[TG_MAIN_DATE - 1]));

  var next = cur, sentDate = d[TG_MAIN_DATE - 1], joinedDate = d[TG_MAIN_JOINED - 1];
  var note = "";

  if (ev === "sent_first" || ev === "sent_repeat") {
    // Нове надсилання знімає ручне «не потрібно / відмовився» — менеджер передумав
    if (!cur || cur === TG_STATUS_NOT_NEEDED || cur === TG_STATUS_REFUSED) next = TG_STATUS_SENT;
    if (!hadSent) sentDate = stamp;
    note = (ev === "sent_first" && !hadSent) ? "вперше" : "повторно";
  } else if (ev === "bot_opened") {
    if (ours && cur !== TG_STATUS_JOINED) next = TG_STATUS_BOT;
    if (!tgsRecentLog_(id, "відкрив бота", when)) note = "відкрив бота: (система)";
  } else if (ev === "joined" || ev === "joined_manual") {
    if (ours || ev === "joined_manual") {
      if (cur !== TG_STATUS_JOINED) note = "приєднався: " + (ev === "joined_manual" ? "(позначив менеджер)" : "(бот системи)");
      next = TG_STATUS_JOINED;
      if (!tgStr_(joinedDate)) joinedDate = stamp;
    }
  } else if (ev === "left") {
    if (ours) { if (cur !== TG_STATUS_LEFT) note = "відписався"; next = TG_STATUS_LEFT; }
  } else if (ev === "blocked") {
    if (ours && cur !== TG_STATUS_JOINED) {
      if (cur !== TG_STATUS_BLOCKED) note = "заблокував бота";
      next = TG_STATUS_BLOCKED;
    }
  } else if (ev === "not_needed" || ev === "refused") {
    var manual = ev === "not_needed" ? TG_STATUS_NOT_NEEDED : TG_STATUS_REFUSED;
    if (cur !== TG_STATUS_JOINED) next = manual;   // факт вступу важливіший
  }

  var changed = next !== cur || sentDate !== d[TG_MAIN_DATE - 1] ||
                joinedDate !== d[TG_MAIN_JOINED - 1];
  var vals = [next, sentDate, tgStr_(d[TG_MAIN_LINK - 1]), d[TG_MAIN_NICK - 1],
              joinedDate, d[TG_MAIN_TGID - 1]];
  if (changed) {
    sheet.getRange(row, TG_MAIN_STATUS, 1, TG_BLOCK).setValues([vals]);
    try {
      sheet.getRange(row, TG_MAIN_STATUS).setNote(
        "Джерело: " + tgsSourceLabel_(src) + "\nКоли: " + stamp);
    } catch (err) { Logger.log("tgApplySysEvent_ note: " + err); }
    var manager = tgStr_(d[COL.MANAGER - 1]);
    tgSyncToManager_(manager, id, vals);
    var twin = tgTwinFromDups_(tgStr_(d[COL.DUPS - 1]));
    if (twin && typeof tg1CMirrorTwin_ === "function") tg1CMirrorTwin_(twin, vals);
  }

  if (note) {
    tgLogAppend_([when, id, tgStr_(d[COL.NAME - 1]), tgStr_(d[COL.PHONE - 1]),
                  tgStr_(d[COL.REGION - 1]), tgStr_(d[COL.MANAGER - 1]),
                  tgStr_(d[TG_MAIN_LINK - 1]), tgsSourceLabel_(src), note]);
  }
  return (changed ? "status:" + next : "same") + (note ? " +log" : "");
}
