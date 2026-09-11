// ============================================================
// L-TEX CRM | TelegramReport.gs  ·  v1.0
// ------------------------------------------------------------
// Звіт у Viber про пророблену роботу: скільки посилань надіслав
// кожен менеджер і по яких областях.
//
// ЗВІДКИ ЦИФРИ
//   Лічимо не «скільки рядків зі статусом», а реальні події з логу
//   «_tg_log»: там кожне надсилання й кожне приєднання записане з
//   датою, областю і менеджером. Тому «за вчора» — це справді за
//   вчора, а не «дата останнього надсилання».
//
//   Надіслано      — клієнт отримав посилання ВПЕРШЕ
//   Повторно       — менеджер відкрив посилання ще раз
//   Приєднались    — клієнт перейшов і зайшов у канал
//   Покриття бази  — скільки всього клієнтів уже опрацьовано
//                    (рахується з таблиць, а не з логу)
//
// ЯК КОРИСТУВАТИСЬ
//   /звіт            — за сьогодні
//   /звіт вчора      — за вчора
//   /звіт тиждень    — за 7 днів
//   /звіт місяць     — за 30 днів
//   /звіт все        — за весь час
//   /звіт детально   — додатково розріз «менеджер × область»
//
//   sendTgWorkReport("вчора")  — надіслати власникам вручну
//   setupTgReportTrigger()     — щодня о 9:00 за вчора
// ============================================================


// Надсилати кожному менеджеру його особисті цифри?
// Вмикається Script Property TG_REPORT_TO_MANAGERS = "так".
var TG_REPORT_PERIODS = {
  "":          {days: 0,   title: "сьогодні"},
  "сьогодні":  {days: 0,   title: "сьогодні"},
  "вчора":     {days: -1,  title: "вчора"},
  "тиждень":   {days: 7,   title: "за 7 днів"},
  "тижд":      {days: 7,   title: "за 7 днів"},
  "місяць":    {days: 30,  title: "за 30 днів"},
  "міс":       {days: 30,  title: "за 30 днів"},
  "все":       {days: 999, title: "за весь час"},
  "всі":       {days: 999, title: "за весь час"}
};


// ╔══════════════════════════════════════════════════════════╗
// ║  1. КОМАНДА БОТА  /звіт                                  ║
// ╚══════════════════════════════════════════════════════════╝
// Патч у Code.gs → doPost, поруч з іншими командами:
//   if (tl.startsWith("/звіт")||tl.startsWith("/звит")||tl.startsWith("/report")) { handleReportCommand(text, sender); return okResponse(); }
function handleReportCommand(text, sender) {
  try {
    var arg      = text.replace(/^\/(звіт|звит|report)\s*/i, "").trim().toLowerCase();
    var detailed = arg.indexOf("детал") >= 0;
    arg = arg.replace(/детально|детал\w*/g, "").trim();

    var period = TG_REPORT_PERIODS[arg];
    if (!period) {
      sendViber(sender.id,
        "Формат команди:\n" +
        "/звіт — за сьогодні\n" +
        "/звіт вчора\n/звіт тиждень\n/звіт місяць\n/звіт все\n" +
        "/звіт детально — розріз «менеджер × область»");
      return;
    }

    var parts = buildTgWorkReport_(period, detailed);
    for (var i = 0; i < parts.length; i++) sendViber(sender.id, parts[i]);
  } catch (err) {
    Logger.log("handleReportCommand: " + err);
    sendViber(sender.id, "Помилка звіту: " + err);
  }
}


// ╔══════════════════════════════════════════════════════════╗
// ║  2. НАДСИЛАННЯ ЗВІТУ                                     ║
// ╚══════════════════════════════════════════════════════════╝
function sendTgWorkReport(periodKey, detailed) {
  var period = TG_REPORT_PERIODS[(periodKey || "вчора").toLowerCase()] || TG_REPORT_PERIODS["вчора"];
  var parts  = buildTgWorkReport_(period, !!detailed);
  for (var i = 0; i < parts.length; i++) notifyOwners(parts[i]);

  // Персональні цифри менеджерам — якщо ввімкнено
  var on = (PropertiesService.getScriptProperties().getProperty("TG_REPORT_TO_MANAGERS") || "")
             .trim().toLowerCase();
  if (on === "так" || on === "yes" || on === "true") sendTgPersonalReports_(period);

  Logger.log(parts.join("\n\n"));
  return parts.join("\n\n");
}

function tgReportJob() { sendTgWorkReport("вчора", false); }

function setupTgReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgReportJob") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("tgReportJob").timeBased().everyDays(1).atHour(9).create();
  Logger.log("✅ Щоденний звіт розсилки встановлено на 9:00 (за вчора)");
}

function removeTgReportTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgReportJob") { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log("Видалено тригерів звіту: " + n);
}

// Кожному менеджеру — тільки його цифри
function sendTgPersonalReports_(period) {
  try {
    var st       = tgCollectStats_(period);
    var managers = tgManagers_();
    for (var name in managers) {
      var m = managers[name];
      if (!m.viberId) continue;
      var mine = st.byManager[name] || {sent: 0, repeat: 0, joined: 0};
      var left = st.leftByManager[name] || 0;
      var regs = st.byManagerRegion[name] || {};
      var top  = tgTopList_(regs, 5);
      sendViber(m.viberId,
        "📊 Ваша розсилка — " + period.title + "\n\n" +
        "Надіслано: " + mine.sent + "\n" +
        "Приєдналось: " + mine.joined + "\n" +
        (top ? "Області: " + top + "\n" : "") +
        "\nЗалишилось у вашій базі: " + left);
    }
  } catch (err) { Logger.log("sendTgPersonalReports_: " + err); }
}


// ╔══════════════════════════════════════════════════════════╗
// ║  3. ЗБІР ЦИФР                                            ║
// ╚══════════════════════════════════════════════════════════╝
function tgCollectStats_(period) {
  var tz    = Session.getScriptTimeZone();
  var now   = new Date();
  var from  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var to    = new Date(from.getTime() + 86400000);

  if (period.days === -1) {                       // вчора
    to   = from;
    from = new Date(from.getTime() - 86400000);
  } else if (period.days > 0) {                   // останні N днів
    from = new Date(from.getTime() - (period.days - 1) * 86400000);
  }
  var all = period.days >= 999;

  var st = {
    title: period.title,
    dateLabel: all ? "за весь час"
      : (period.days === 0 || period.days === -1
          ? Utilities.formatDate(from, tz, "dd.MM.yyyy")
          : Utilities.formatDate(from, tz, "dd.MM") + "–" +
            Utilities.formatDate(new Date(to.getTime() - 86400000), tz, "dd.MM.yyyy")),
    sent: 0, repeat: 0, joined: 0, orphan: 0, sentLead: 0, sent1C: 0,
    byManager: {}, byRegion: {}, byManagerRegion: {},
    coverage: null, leftByManager: {}
  };

  // ── Події з логу ──
  var log = tgSS_(MAIN_FILE_ID).getSheetByName(TG_LOG_SHEET);
  if (log && log.getLastRow() >= 2) {
    var rows = log.getRange(2, 1, log.getLastRow() - 1, 9).getValues();
    for (var i = 0; i < rows.length; i++) {
      var d = tgAsDate_(rows[i][0]);
      if (!d) continue;
      if (!all && (d < from || d >= to)) continue;

      var id     = tgStr_(rows[i][1]);
      var region = tgStr_(rows[i][4]) || "Без області";
      var mgr    = tgStr_(rows[i][5]) || "Без менеджера";
      var note   = tgStr_(rows[i][8]).toLowerCase();
      var src    = tgStr_(rows[i][7]).toLowerCase();
      if (src.indexOf("скасув") >= 0) continue;

      if (!st.byManager[mgr]) st.byManager[mgr] = {sent: 0, repeat: 0, joined: 0};
      if (!st.byRegion[region]) st.byRegion[region] = {sent: 0, joined: 0};

      if (note.indexOf("вперше") === 0) {
        st.sent++; st.byManager[mgr].sent++; st.byRegion[region].sent++;
        if (id.indexOf("1C-") === 0) st.sent1C++; else st.sentLead++;
        if (!st.byManagerRegion[mgr]) st.byManagerRegion[mgr] = {};
        st.byManagerRegion[mgr][region] = (st.byManagerRegion[mgr][region] || 0) + 1;
      } else if (note.indexOf("повторно") === 0) {
        st.repeat++; st.byManager[mgr].repeat++;
      } else if (note.indexOf("приєднався") === 0) {
        st.joined++; st.byManager[mgr].joined++; st.byRegion[region].joined++;
      } else if (note.indexOf("не привʼязано") === 0) {
        // вступив, але за посиланням, якого немає в таблиці
        st.orphan++;
      }
    }
  }

  st.coverage = tgCoverage_(st.leftByManager);
  return st;
}

// Покриття бази: скільки клієнтів уже опрацьовано в кожній таблиці
function tgCoverage_(leftByManager) {
  var out = {lead: {done: 0, total: 0}, ons: {done: 0, total: 0}};
  var sheets = [
    {sheet: tgMainSheetCached_(), key: "lead"},
    {sheet: tg1CSheetName_() ? tgSS_(MAIN_FILE_ID).getSheetByName(tg1CSheetName_()) : null, key: "ons"}
  ];

  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s].sheet;
    if (!sh) continue;
    var last = sh.getLastRow();
    if (last < DATA_START) continue;
    var n = last - DATA_START + 1;
    if (sh.getMaxColumns() < TG_MAIN_STATUS) continue;

    var ids  = sh.getRange(DATA_START, COL.ID,        n, 1).getValues();
    var mgrs = sh.getRange(DATA_START, COL.MANAGER,   n, 1).getValues();
    var sts  = sh.getRange(DATA_START, TG_MAIN_STATUS, n, 1).getValues();

    for (var i = 0; i < n; i++) {
      if (!tgStr_(ids[i][0])) continue;
      var mgr = tgStr_(mgrs[i][0]) || "Без менеджера";
      out[sheets[s].key].total++;
      if (tgIsSent_(sts[i][0])) out[sheets[s].key].done++;
      else leftByManager[mgr] = (leftByManager[mgr] || 0) + 1;
    }
  }
  return out;
}


// ╔══════════════════════════════════════════════════════════╗
// ║  4. ТЕКСТ ЗВІТУ                                          ║
// ╚══════════════════════════════════════════════════════════╝
function buildTgWorkReport_(period, detailed) {
  var st    = tgCollectStats_(period);
  var parts = [];

  // ── Головне ──
  var head = "📊 РОЗСИЛКА TELEGRAM — " + st.title + " (" + st.dateLabel + ")\n" +
             "════════════════════════\n\n" +
             "📨 Надіслано вперше: " + st.sent + "\n";
  if (st.sent) head += "   ліди " + st.sentLead + " · база 1С " + st.sent1C + "\n";
  if (st.repeat) head += "🔁 Повторних відкриттів: " + st.repeat + "\n";
  head += "👤 Приєднались до каналу: " + st.joined + "\n";
  if (st.sent) {
    head += "   конверсія: " + Math.round(st.joined * 100 / st.sent) + "%\n";
  }
  if (st.orphan) {
    head += "❓ Вступили, але не впізнані: " + st.orphan + "\n" +
            "   прийшли не за персональним посиланням\n";
  }
  parts.push(head);

  // ── Менеджери ──
  var mgrList = [];
  for (var m in st.byManager) {
    mgrList.push({name: m, sent: st.byManager[m].sent, joined: st.byManager[m].joined,
                  left: st.leftByManager[m] || 0});
  }
  mgrList.sort(function (a, b) { return b.sent - a.sent; });

  var mgrTxt = "👤 МЕНЕДЖЕРИ (надіслано / приєднались)\n";
  if (!mgrList.length) {
    mgrTxt += "  за цей період нічого не надсилали\n";
  } else {
    mgrList.forEach(function (it) {
      mgrTxt += "  " + it.name + " — " + it.sent + " / " + it.joined + "\n";
    });
  }
  parts.push(mgrTxt);

  // ── Області ──
  var regList = [];
  for (var r in st.byRegion) {
    regList.push({name: r, sent: st.byRegion[r].sent, joined: st.byRegion[r].joined});
  }
  regList.sort(function (a, b) { return b.sent - a.sent; });
  if (regList.length) {
    var regTxt = "🗺 ОБЛАСТІ (надіслано / приєднались)\n";
    regList.forEach(function (it) {
      if (it.sent || it.joined) regTxt += "  " + it.name + " — " + it.sent + " / " + it.joined + "\n";
    });
    parts.push(regTxt);
  }

  // ── Менеджер × область ──
  if (detailed) {
    var det = "🗺 МЕНЕДЖЕР × ОБЛАСТЬ\n";
    var any = false;
    for (var mm in st.byManagerRegion) {
      var line = tgTopList_(st.byManagerRegion[mm], 99);
      if (!line) continue;
      det += "\n" + mm + ":\n  " + line + "\n";
      any = true;
    }
    if (any) parts.push(det);
  }

  // ── Покриття бази ──
  var cov  = st.coverage;
  var tot  = {done: cov.lead.done + cov.ons.done, total: cov.lead.total + cov.ons.total};
  var pct  = function (o) { return o.total ? Math.round(o.done * 100 / o.total) + "%" : "—"; };
  var covTxt = "📈 ПОКРИТТЯ БАЗИ (усього надіслано)\n" +
               "  Ліди: " + cov.lead.done + " з " + cov.lead.total + " (" + pct(cov.lead) + ")\n" +
               "  База 1С: " + cov.ons.done + " з " + cov.ons.total + " (" + pct(cov.ons) + ")\n" +
               "  Разом: " + tot.done + " з " + tot.total + " (" + pct(tot) + ")\n";

  var leftList = [];
  for (var lm in st.leftByManager) leftList.push({name: lm, left: st.leftByManager[lm]});
  leftList.sort(function (a, b) { return b.left - a.left; });
  if (leftList.length) {
    covTxt += "\nЗалишилось надіслати:\n";
    leftList.forEach(function (it) { covTxt += "  " + it.name + " — " + it.left + "\n"; });
  }
  parts.push(covTxt);

  return parts;
}

// Значення з таблиці — дата? Перевіряємо не лише instanceof: у логу
// можуть лежати і текстові дати, і обʼєкти з іншого контексту.
function tgAsDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v.getTime === "function") { var n = v.getTime(); return isNaN(n) ? null : v; }
  var s = tgStr_(v);
  if (!s) return null;
  var m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/.exec(s);   // 09.09.2026
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// «Волинська 22 · Рівненська 16 · Львівська 4»
function tgTopList_(obj, limit) {
  var arr = [];
  for (var k in obj) arr.push({name: k, n: obj[k]});
  arr.sort(function (a, b) { return b.n - a.n; });
  return arr.slice(0, limit).map(function (it) { return it.name + " " + it.n; }).join(" · ");
}


// ╔══════════════════════════════════════════════════════════╗
// ║  5. ПЕРЕВІРКА                                            ║
// ╚══════════════════════════════════════════════════════════╝
function testTgReport() {
  var parts = buildTgWorkReport_(TG_REPORT_PERIODS["все"], true);
  Logger.log(parts.join("\n"));
  return parts.join("\n");
}
