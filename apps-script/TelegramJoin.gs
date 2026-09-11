// ============================================================
// L-TEX CRM | TelegramJoin.gs  ·  v1.0
// ------------------------------------------------------------
// Персональне посилання на КОЖНОГО клієнта + автоматичний запис
// його нікнейму в Telegram у таблицю.
//
// ЯК ЦЕ ПОВʼЯЗУЄ НІК З НОМЕРОМ
//   1. Менеджер тисне кнопку в рядку → бот створює запрошення
//      з назвою «LTEX-20260909-1234 Іванова С» (ID цього ліда).
//   2. Клієнт переходить за посиланням → Telegram надсилає боту
//      подію вступу, а в ній: і сам користувач (@нік, імʼя, id),
//      і посилання, за яким він прийшов.
//   3. За назвою посилання знаходимо рядок ліда — а в рядку вже
//      є телефон. Нік і телефон повʼязані без жодної ручної дії.
//   4. У таблицю пишеться нікнейм, дата приєднання і статус
//      «👤 Приєднався», менеджеру летить сповіщення у Viber.
//
// Потрібен бот-адміністратор каналу. Встановлення — README.md
// ============================================================


// ── Налаштування ──────────────────────────────────────────
// Script Properties:
//   TG_BOT_TOKEN     — токен бота (адміністратора каналу)
//   TG_CHAT_ID       — ID каналу; або окремо по областях
//                      у колонці C аркуша «🔗 TG-посилання»
//   TG_LINK_MODE     — "request" (типово) | "personal" | "off"
//   TG_AUTO_APPROVE  — "ні", щоб НЕ схвалювати заявки автоматично
//   TG_HOOK_SECRET   — створюється сам при setTelegramWebhook()

function tgBotToken_() {
  return (PropertiesService.getScriptProperties().getProperty("TG_BOT_TOKEN") || "").trim();
}

function tgApi_(method, payload) {
  var token = tgBotToken_();
  if (!token) return {ok: false, description: "TG_BOT_TOKEN не задано"};
  try {
    var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/" + method, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify(payload || {}), muteHttpExceptions: true
    });
    var j = JSON.parse(res.getContentText());
    if (!j.ok) Logger.log("tgApi_ " + method + ": " + res.getContentText().substring(0, 300));
    return j;
  } catch (err) {
    Logger.log("tgApi_ " + method + ": " + err);
    return {ok: false, description: String(err)};
  }
}

// Типові відповіді Telegram — людською мовою
function tgExplainTgError_(desc) {
  var d = (desc || "").toString().toLowerCase();
  if (d.indexOf("chat not found") >= 0)
    return "бот НЕ доданий у канал як адміністратор, або невірний TG_CHAT_ID " +
           "(має бути число з мінусом, напр. -1001234567890)";
  if (d.indexOf("not enough rights") >= 0 || d.indexOf("chat_admin_required") >= 0 ||
      d.indexOf("need administrator rights") >= 0)
    return "боту бракує права «Запрошувати користувачів через посилання» в каналі";
  if (d.indexOf("unauthorized") >= 0)
    return "невірний TG_BOT_TOKEN — перевірте його в @BotFather";
  if (d.indexOf("bot was kicked") >= 0 || d.indexOf("bot is not a member") >= 0)
    return "бота видалили з каналу — додайте його адміністратором знову";
  return desc || "невідома помилка";
}

// Секрет у query-рядку вебхука: заголовки в doGet/doPost недоступні,
// тому підпис передаємо параметром ?tghook=…
function tgHookSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty("TG_HOOK_SECRET");
  if (!s) { s = Utilities.getUuid().replace(/-/g, ""); props.setProperty("TG_HOOK_SECRET", s); }
  return s;
}


// ╔══════════════════════════════════════════════════════════╗
// ║  1. ВЕБХУК TELEGRAM                                      ║
// ╚══════════════════════════════════════════════════════════╝
// Запустити ОДИН РАЗ після того, як опубліковано нову версію деплою.
function setTelegramWebhook() {
  var url = getTgTrackUrl_() + "?tghook=" + tgHookSecret_();
  var r = tgApi_("setWebhook", {
    url: url,
    allowed_updates: ["chat_join_request", "chat_member", "my_chat_member"],
    drop_pending_updates: true
  });
  Logger.log(r.ok ? "✅ Вебхук Telegram встановлено:\n" + url
                  : "❌ " + (r.description || "невідома помилка"));
  return r;
}

function deleteTelegramWebhook() {
  var r = tgApi_("deleteWebhook", {drop_pending_updates: false});
  Logger.log(r.ok ? "✅ Вебхук Telegram знято" : "❌ " + (r.description || ""));
  return r;
}

function getTelegramWebhookInfo() {
  var r = tgApi_("getWebhookInfo", {});
  Logger.log(JSON.stringify(r.result || r, null, 2));
  return r;
}


// ╔══════════════════════════════════════════════════════════╗
// ║  2. ОБРОБНИК ПОДІЙ (виклик з doPost у Code.gs)           ║
// ╚══════════════════════════════════════════════════════════╝
// Патч у Code.gs → doPost, одразу після `var data = ...`:
//   if (data && data.update_id) return handleTelegramUpdate(data, e);
function handleTelegramUpdate(data, e) {
  try {
    var given = (e && e.parameter && e.parameter.tghook) ? e.parameter.tghook.toString() : "";
    if (given !== tgHookSecret_()) { Logger.log("TG hook: невірний секрет — запит проігноровано"); return tgOk_(); }

    // Перевірка звʼязку (testTgJoinPath): якщо цей рядок спрацював, отже
    // doPost у Code.gs справді передає оновлення сюди й секрет збігається
    if (data.tgprobe) {
      PropertiesService.getScriptProperties().setProperty("TG_PROBE_AT",
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm:ss"));
      return tgOk_();
    }

    if (tgAlreadySeen_(data.update_id)) return tgOk_();
    tgHandleUpdateObject_(data);
    return tgOk_();
  } catch (err) {
    Logger.log("handleTelegramUpdate: " + err);
    return tgOk_();   // 200 у будь-якому разі, інакше Telegram шле повтори
  }
}

function tgOk_() {
  return ContentService.createTextOutput('{"ok":true}').setMimeType(ContentService.MimeType.JSON);
}

// Заявка на вступ (TG_LINK_MODE = "request")
// Apps Script на POST віддає 302 (перенаправлення на googleusercontent),
// а Telegram вважає 200 єдиною успішною відповіддю. Тому він повторює
// доставку — і кожен повтор виглядав як новий вступ: зайві записи в лозі
// й повторні «🎉 Клієнт приєднався» менеджеру.
//
// update_id у Telegram лише зростає, тож достатньо памʼятати найбільший
// опрацьований. Кеш лишаємо як другий рубіж — від одночасних доставок.
function tgAlreadySeen_(updateId) {
  var id = parseInt(updateId, 10);
  if (!id) return false;

  var cache = CacheService.getScriptCache();
  var key   = "tgu_" + id;
  if (cache.get(key)) return true;
  cache.put(key, "1", 21600);            // 6 годин — максимум для кешу

  var last = parseInt(tgProp_("TG_LAST_UPDATE_ID"), 10) || 0;
  if (id <= last) return true;
  tgSetProp_("TG_LAST_UPDATE_ID", String(id));
  return false;
}

function tgHandleUpdateObject_(u) {
  if (u.chat_join_request)   tgOnJoinRequest_(u.chat_join_request);
  else if (u.chat_member)    tgOnChatMember_(u.chat_member);
  else if (u.my_chat_member) Logger.log("TG my_chat_member: " + JSON.stringify(u.my_chat_member).substring(0, 300));
}


// ╔══════════════════════════════════════════════════════════╗
// ║  Опитування замість вебхука                              ║
// ╚══════════════════════════════════════════════════════════╝
// Вебхук на Apps Script працює, але кожну доставку Telegram вважає
// невдалою через 302 і повторює її. Опитування знімає це повністю:
// ми самі забираємо оновлення й самі підтверджуємо їх зсувом offset.
// Плата — затримка до хвилини; для запису вступів це неважливо.
//
//   useTelegramPolling()  — перейти на опитування (вебхук знімається)
//   useTelegramWebhook()  — повернутись на вебхук
function useTelegramPolling() {
  deleteTelegramWebhook();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgPollJob") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("tgPollJob").timeBased().everyMinutes(1).create();
  Logger.log("✅ Перейшли на опитування: раз на хвилину забираємо оновлення самі.\n" +
             "   Повернутись на вебхук — useTelegramWebhook()");
}

function useTelegramWebhook() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgPollJob") ScriptApp.deleteTrigger(t);
  });
  return setTelegramWebhook();
}

function tgPollJob() {
  var offset = parseInt(tgProp_("TG_POLL_OFFSET"), 10) || 0;
  var seen = 0;
  for (var pass = 0; pass < 5; pass++) {
    var r = tgApi_("getUpdates", {
      offset: offset, timeout: 0, limit: 50,
      allowed_updates: ["chat_join_request", "chat_member", "my_chat_member"]
    });
    if (!r.ok) {
      Logger.log("tgPollJob: " + tgExplainTgError_(r.description));
      return;
    }
    var list = r.result || [];
    if (!list.length) break;

    for (var i = 0; i < list.length; i++) {
      offset = list[i].update_id + 1;
      seen++;
      try {
        if (!tgAlreadySeen_(list[i].update_id)) tgHandleUpdateObject_(list[i]);
      } catch (err) { Logger.log("tgPollJob update: " + err); }
    }
    tgSetProp_("TG_POLL_OFFSET", String(offset));
    if (list.length < 50) break;
  }
  if (seen) Logger.log("tgPollJob: опрацьовано оновлень — " + seen);
}


function tgOnJoinRequest_(req) {
  var chat = req.chat || {};
  var user = req.from || {};
  tgRecordJoin_(user, req.invite_link || {}, chat, "заявка на вступ");

  var auto = (PropertiesService.getScriptProperties().getProperty("TG_AUTO_APPROVE") || "").trim().toLowerCase();
  if (auto === "ні" || auto === "no" || auto === "false") return;
  var r = tgApi_("approveChatJoinRequest", {chat_id: chat.id, user_id: user.id});
  Logger.log(r.ok ? "TG: заявку схвалено — " + tgUserLabel_(user)
                  : "TG: не вдалось схвалити заявку — " + (r.description || ""));
}

// Вступ у канал (TG_LINK_MODE = "personal")
function tgOnChatMember_(upd) {
  var nw = upd.new_chat_member || {}, old = upd.old_chat_member || {};
  var isIn  = function (st) { return st === "member" || st === "administrator" || st === "creator"; };
  if (!isIn(nw.status) || isIn(old.status)) return;   // цікавить лише момент вступу
  tgRecordJoin_(nw.user || upd.from, upd.invite_link || {}, upd.chat || {}, "вступ за посиланням");
}


// ╔══════════════════════════════════════════════════════════╗
// ║  3. ЗАПИС НІКНЕЙМУ В ТАБЛИЦЮ                             ║
// ╚══════════════════════════════════════════════════════════╝
function tgRecordJoin_(user, link, chat, kind) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { Logger.log("tgRecordJoin_: не вдалось узяти блокування"); return; }
  try {
    var nick      = tgUserLabel_(user);
    var inviteUrl = tgStr_(link.invite_link);
    var linkName  = tgStr_(link.name);
    var stamp     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");

    var found = tgFindRowByLink_(inviteUrl, linkName);
    var main  = found.sheet;
    var row   = found.row;

    // Прийшов не за персональним посиланням (напр. за посиланням області)
    if (row === -1 || !main) {
      tgLogAppend_([new Date(), "", "", "", "", "", inviteUrl, kind,
                    "не привʼязано до ліда · " + nick + (linkName ? " · «" + linkName + "»" : "")]);
      Logger.log("TG: " + nick + " приєднався за посиланням «" + (linkName || inviteUrl) + "» — ліда не знайдено");
      return;
    }

    var d       = main.getRange(row, 1, 1, TG_MAIN_JOINED).getValues()[0];
    var id      = tgStr_(d[COL.ID - 1]);
    var name    = tgStr_(d[COL.NAME - 1]);
    var phone   = tgStr_(d[COL.PHONE - 1]);
    var region  = tgStr_(d[COL.REGION - 1]);
    var manager = tgStr_(d[COL.MANAGER - 1]);
    var wasNick = tgStr_(d[TG_MAIN_NICK - 1]);

    var vals = [
      TG_STATUS_JOINED,
      tgStr_(d[TG_MAIN_DATE - 1]) || stamp,     // дату надсилання зберігаємо
      tgStr_(d[TG_MAIN_LINK - 1]) || inviteUrl,
      nick,
      tgStr_(d[TG_MAIN_JOINED - 1]) || stamp    // перше приєднання не переписуємо
    ];
    main.getRange(row, TG_MAIN_STATUS, 1, TG_BLOCK).setValues([vals]);

    try {
      main.getRange(row, TG_MAIN_NICK).setNote(
        "Telegram id: " + (user && user.id ? user.id : "—") +
        "\nІмʼя в Telegram: " + [user && user.first_name, user && user.last_name].filter(String).join(" ") +
        "\nКанал: " + (chat && chat.title ? chat.title : "—") +
        "\nПосилання: " + (linkName || inviteUrl) +
        "\nПодія: " + kind + " · " + stamp);
    } catch (err) { Logger.log("tgRecordJoin_ note: " + err); }

    // Колонка «Telegram» (O) заповнюється, лише якщо була порожня
    if (!tgStr_(d[COL.TG - 1])) main.getRange(row, COL.TG).setValue(nick);

    tgSyncToManager_(manager, id, vals);
    var twin = (typeof tg1CTwinId_ === "function") ? tg1CTwinId_(main, row) : "";
    if (twin && typeof tg1CMirrorTwin_ === "function") tg1CMirrorTwin_(twin, vals);
    tgLogAppend_([new Date(), id, name, phone, region, manager, vals[2], kind,
                  "приєднався: " + nick + (wasNick && wasNick !== nick ? " (було " + wasNick + ")" : "")]);

    // Сповіщення менеджеру: нік + номер в одному повідомленні
    try {
      var mgr = manager ? tgManagers_()[manager] : null;
      if (mgr && mgr.viberId) {
        sendViber(mgr.viberId,
          "🎉 Клієнт приєднався до Telegram-каналу!\n\n" +
          "Нік: " + nick + "\n" +
          "ПІБ: " + (name || "—") + "\n" +
          "Телефон: " + (phone || "—") + "\n" +
          "Область: " + (region || "—") + "\n" +
          "ID: " + id + "\n" +
          "Час: " + stamp);
      }
    } catch (err) { Logger.log("tgRecordJoin_ viber: " + err); }

    Logger.log("TG: " + nick + " → " + id + " (" + name + ", " + phone + ")");
  } catch (err) {
    Logger.log("tgRecordJoin_: " + err);
  } finally {
    lock.releaseLock();
  }
}

// Пошук рядка: спершу за точним URL посилання, далі за ID у його назві.
// Шукаємо і серед лідів, і серед клієнтів 1С.
function tgFindRowByLink_(inviteUrl, linkName) {
  var sheets = [tgMainSheetCached_()];
  var reg = tg1CSheetName_() ? tgSS_(MAIN_FILE_ID).getSheetByName(tg1CSheetName_()) : null;
  if (reg) sheets.push(reg);

  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s];
    if (!sh) continue;
    var lastRow = sh.getLastRow();
    if (lastRow < DATA_START) continue;
    if (inviteUrl) {
      var n = lastRow - DATA_START + 1;
      var links = sh.getRange(DATA_START, TG_MAIN_LINK, n, 1).getValues();
      for (var i = 0; i < n; i++) {
        if (tgStr_(links[i][0]) === inviteUrl) return {sheet: sh, row: DATA_START + i};
      }
    }
  }

  var id = tgLeadIdFromLinkName_(linkName);
  if (id) {
    var target = tgSheetForId_(id);
    if (target) {
      var r = tgFindRow_(target, COL.ID, DATA_START, id);
      if (r !== -1) return {sheet: target, row: r};
    }
  }
  return {sheet: null, row: -1};
}

// «@ivan_petrov» або «Іван Петров (id 123456789)», якщо ніку немає
function tgUserLabel_(user) {
  if (!user) return "—";
  if (user.username) return "@" + user.username;
  var n = [user.first_name, user.last_name].filter(String).join(" ").trim();
  return (n || "Без імені") + " (id " + (user.id || "?") + ")";
}


// ╔══════════════════════════════════════════════════════════╗
// ║  4. ПОШУК «НІК ↔ ТЕЛЕФОН» + команда бота /нік            ║
// ╚══════════════════════════════════════════════════════════╝
// Патч у Code.gs → doPost:
//   if (tl.startsWith("/нік")||tl.startsWith("/nick")) { handleNickCommand(text, sender); return okResponse(); }
function handleNickCommand(text, sender) {
  try {
    var q = text.replace(/^\/(нік|ник|nick)\s*/i, "").trim();
    if (!q) {
      sendViber(sender.id, "Формат команди:\n/нік @ivan_petrov — хто це за номером\n/нік 0671234567 — який нік у клієнта");
      return;
    }
    var r = findLeadByTgNick(q);
    if (!r) {
      sendViber(sender.id, "❌ Нічого не знайдено за запитом «" + q + "».\n" +
        "Нік потрапляє в таблицю автоматично, коли клієнт переходить за персональним посиланням.");
      return;
    }
    sendViber(sender.id,
      "🔎 Знайдено:\n\n" +
      "Нік: " + (r.nick || "—") + "\n" +
      "ПІБ: " + (r.name || "—") + "\n" +
      "Телефон: " + (r.phone || "—") + "\n" +
      "Область: " + (r.region || "—") + "\n" +
      "Менеджер: " + (r.manager || "—") + "\n" +
      "Статус TG: " + (r.status || "—") +
      (r.joined ? "\nПриєднався: " + r.joined : "") + "\n" +
      "ID: " + r.id);
  } catch (err) {
    Logger.log("handleNickCommand: " + err);
    sendViber(sender.id, "Помилка: " + err);
  }
}

// Пошук в обидва боки: за ніком (@ivan) або за номером телефону
function findLeadByTgNick(query) {
  var sheets = [tgMainSheetCached_()];
  var reg = tg1CSheetName_() ? tgSS_(MAIN_FILE_ID).getSheetByName(tg1CSheetName_()) : null;
  if (reg) sheets.push(reg);
  for (var s = 0; s < sheets.length; s++) {
    var hit = tgFindByNickInSheet_(sheets[s], query);
    if (hit) return hit;
  }
  return null;
}

function tgFindByNickInSheet_(main, query) {
  if (!main || main.getMaxColumns() < TG_MAIN_JOINED) return null;
  var lastRow = main.getLastRow();
  if (lastRow < DATA_START) return null;

  var q      = tgStr_(query).toLowerCase().replace(/^@/, "");
  var digits = q.replace(/\D/g, "");
  var byPhone = digits.length >= 8 ? digits.slice(-9) : "";
  var data = main.getRange(DATA_START, 1, lastRow - DATA_START + 1, TG_MAIN_JOINED).getValues();

  for (var i = 0; i < data.length; i++) {
    var nick = tgStr_(data[i][TG_MAIN_NICK - 1]);
    var hit  = false;
    if (byPhone) {
      var ph = tgStr_(data[i][COL.PHONE - 1]).replace(/\D/g, "").slice(-9);
      hit = ph.length >= 8 && ph === byPhone;
    } else if (nick) {
      hit = nick.toLowerCase().replace(/^@/, "").indexOf(q) === 0;
    }
    if (!hit) continue;
    return {
      id:      tgStr_(data[i][COL.ID - 1]),
      name:    tgStr_(data[i][COL.NAME - 1]),
      phone:   tgStr_(data[i][COL.PHONE - 1]),
      region:  tgStr_(data[i][COL.REGION - 1]),
      manager: tgStr_(data[i][COL.MANAGER - 1]),
      nick:    nick,
      status:  tgStr_(data[i][TG_MAIN_STATUS - 1]),
      joined:  tgStr_(data[i][TG_MAIN_JOINED - 1])
    };
  }
  return null;
}


// ╔══════════════════════════════════════════════════════════╗
// ║  5. СПИСОК УЧАСНИКІВ КАНАЛУ                              ║
// ╚══════════════════════════════════════════════════════════╝
// ВАЖЛИВО, ЧОГО ЗРОБИТИ НЕ МОЖНА
//   Telegram навмисно не дає ботам перелічувати учасників каналу:
//   у Bot API просто немає такого методу. Доступні лише
//   getChatMemberCount (скільки всього) і getChatMember (про одну
//   конкретну людину, якщо вже знаєш її id). Номер телефону бот
//   не бачить ніколи — лише якщо людина сама надішле контакт у
//   приватному чаті з ботом.
//
//   Тому список будується з НАШИХ даних: усі, хто перейшов за
//   персональним посиланням, уже записані в таблицях разом з ніком.
//   Телефон береться з картки клієнта — саме та звʼязка «нік ↔ номер»,
//   заради якої все й робилось.
//
//   exportTgMembers() — вивантажити список у лист «👥 Учасники каналу»
//   /учасники        — підсумок у Viber

var TG_MEMBERS_SHEET = "👥 Учасники каналу";

function exportTgMembers() {
  var members = tgKnownMembers_();
  var total   = tgChannelMemberCount_();

  var ss = tgSS_(MAIN_FILE_ID);
  var sh = ss.getSheetByName(TG_MEMBERS_SHEET);
  if (!sh) sh = ss.insertSheet(TG_MEMBERS_SHEET);
  sh.clear();

  var head = ["Нік у Telegram", "ПІБ", "Телефон", "Область", "Менеджер",
              "Дата приєднання", "Джерело", "ID"];
  sh.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight("bold").setBackground("#2E6DA4").setFontColor("#FFFFFF");
  sh.setFrozenRows(1);

  if (members.length) {
    var vals = members.map(function (m) {
      return [m.nick, m.name, m.phone, m.region, m.manager, m.joined, m.src, m.id];
    });
    if (sh.getMaxRows() < vals.length + 1) sh.insertRowsAfter(sh.getMaxRows(), vals.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, vals.length, head.length).setValues(vals);
    sh.getRange(2, 3, vals.length, 1).setNumberFormat("@");
  }
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 220); sh.setColumnWidth(3, 130);
  sh.setColumnWidth(4, 150); sh.setColumnWidth(5, 170); sh.setColumnWidth(6, 140);

  var msg = "👥 Учасники каналу\n" +
            "Розпізнано (є в наших таблицях): " + members.length + "\n" +
            (total ? "Усього підписників у каналі: " + total + "\n" +
                     "Нерозпізнаних: " + Math.max(total - members.length, 0) +
                     " — приєднались до запуску системи або не за нашим посиланням\n" : "") +
            "Список: лист «" + TG_MEMBERS_SHEET + "» головної таблиці";
  Logger.log(msg);
  return msg;
}

// Усі, про кого ми знаємо, що вони в каналі: у рядку заповнений нік
function tgKnownMembers_() {
  var out = [];
  var sources = [{sheet: tgMainSheetCached_(), src: "Ліди"}];
  if (tg1CSheetName_()) {
    var reg = tgSS_(MAIN_FILE_ID).getSheetByName(tg1CSheetName_());
    if (reg) sources.push({sheet: reg, src: "База 1С"});
  }

  for (var s = 0; s < sources.length; s++) {
    var sh = sources[s].sheet;
    if (!sh || sh.getMaxColumns() < TG_MAIN_JOINED) continue;
    var last = sh.getLastRow();
    if (last < DATA_START) continue;
    var data = sh.getRange(DATA_START, 1, last - DATA_START + 1, TG_MAIN_JOINED).getValues();
    for (var i = 0; i < data.length; i++) {
      var nick = tgStr_(data[i][TG_MAIN_NICK - 1]);
      if (!nick) continue;
      out.push({
        nick:    nick,
        name:    tgStr_(data[i][COL.NAME - 1]),
        phone:   tgStr_(data[i][COL.PHONE - 1]),
        region:  tgStr_(data[i][COL.REGION - 1]),
        manager: tgStr_(data[i][COL.MANAGER - 1]),
        joined:  tgStr_(data[i][TG_MAIN_JOINED - 1]),
        src:     sources[s].src,
        id:      tgStr_(data[i][COL.ID - 1])
      });
    }
  }

  // Найновіші зверху
  out.sort(function (a, b) {
    var da = tgJoinTime_(a.joined), db = tgJoinTime_(b.joined);
    return db - da;
  });
  return out;
}

function tgJoinTime_(s) {
  var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(tgStr_(s));
  if (!m) return 0;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
}

// Скільки всього підписників — єдине, що Bot API дає про склад каналу
function tgChannelMemberCount_() {
  try {
    var chatId = (typeof tgProp_ === "function")
      ? tgProp_("TG_CHAT_ID")
      : (PropertiesService.getScriptProperties().getProperty("TG_CHAT_ID") || "").trim();
    if (!chatId) return 0;
    var r = tgApi_("getChatMemberCount", {chat_id: chatId});
    if (r && r.ok) return r.result;
    r = tgApi_("getChatMembersCount", {chat_id: chatId});   // назва до Bot API 5.7
    return (r && r.ok) ? r.result : 0;
  } catch (err) { Logger.log("tgChannelMemberCount_: " + err); return 0; }
}

// Патч у Code.gs → doPost, поруч з іншими командами:
//   if (tl.startsWith("/учасники")||tl.startsWith("/members")) { handleMembersCommand(text, sender); return okResponse(); }
function handleMembersCommand(text, sender) {
  try {
    var members = tgKnownMembers_();
    var total   = tgChannelMemberCount_();

    var byMgr = {};
    members.forEach(function (m) {
      var k = m.manager || "Без менеджера";
      byMgr[k] = (byMgr[k] || 0) + 1;
    });

    var txt = "👥 УЧАСНИКИ КАНАЛУ\n════════════════\n\n" +
              "Розпізнано: " + members.length + "\n";
    if (total) {
      txt += "Усього підписників: " + total + "\n" +
             "Нерозпізнаних: " + Math.max(total - members.length, 0) + "\n";
    }
    txt += "\nПо менеджерах:\n";
    var list = [];
    for (var k in byMgr) list.push({name: k, n: byMgr[k]});
    list.sort(function (a, b) { return b.n - a.n; });
    list.forEach(function (it) { txt += "  " + it.name + " — " + it.n + "\n"; });
    sendViber(sender.id, txt);

    var recent = members.slice(0, 10);
    if (recent.length) {
      var r = "🆕 Останні приєднання:\n\n";
      recent.forEach(function (m) {
        r += m.nick + "\n  " + (m.name || "—") + " · " + (m.phone || "без номера") +
             (m.joined ? " · " + m.joined : "") + "\n";
      });
      r += "\nПовний список — лист «" + TG_MEMBERS_SHEET + "» у головній таблиці " +
           "(оновити: exportTgMembers).";
      sendViber(sender.id, r);
    }
  } catch (err) {
    Logger.log("handleMembersCommand: " + err);
    sendViber(sender.id, "Помилка: " + err);
  }
}


// ╔══════════════════════════════════════════════════════════╗
// ║  6. ПЕРЕВІРКА НАЛАШТУВАНЬ БОТА                           ║
// ╚══════════════════════════════════════════════════════════╝
// Розбір: чому вступ не привʼязався до клієнта. Дивиться, за якими саме
// посиланнями приходили люди, і чи є ці посилання в таблиці.
//   порожнє посилання — людина зайшла через головне посилання каналу
//   (реклама, пошук, переслали): бот не має за чим її впізнати;
//   посилання є, але його немає в таблиці — видали не ми або рядок чистили.
function tgWhyNotMatched(limit) {
  var max = parseInt(limit, 10) || 15;
  var ss  = tgSS_(MAIN_FILE_ID);
  var log = ss.getSheetByName(TG_LOG_SHEET);
  var out = ["🔎 ЧОМУ ВСТУПИ НЕ ПРИВʼЯЗАЛИСЬ", ""];
  if (!log || log.getLastRow() < 2) { Logger.log("Лог порожній"); return "Лог порожній"; }

  var rows = log.getRange(2, 1, log.getLastRow() - 1, 9).getValues();
  var byLink = {}, noLink = 0, total = 0, people = {};
  for (var i = 0; i < rows.length; i++) {
    if (tgStr_(rows[i][8]).toLowerCase().indexOf("не привʼязано") !== 0) continue;
    total++;
    var link = tgStr_(rows[i][6]);
    var who  = tgStr_(rows[i][8]).split("·")[1] || "";
    people[who.trim()] = true;
    if (!link) { noLink++; continue; }
    byLink[link] = (byLink[link] || 0) + 1;
  }

  // Які посилання взагалі є в таблицях
  var known = {};
  [MAIN_SHEET, (typeof TG1C_SHEET === "string" ? TG1C_SHEET : "")].forEach(function (nm) {
    if (!nm) return;
    var sh = ss.getSheetByName(nm);
    if (!sh || sh.getMaxColumns() < TG_MAIN_LINK) return;
    var n = sh.getLastRow() - DATA_START + 1;
    if (n < 1) return;
    var v = sh.getRange(DATA_START, TG_MAIN_LINK, n, 1).getValues();
    for (var i = 0; i < n; i++) { var L = tgStr_(v[i][0]); if (L) known[L] = true; }
  });

  out.push("Записів «не привʼязано»: " + total + " · різних людей: " +
           (Object.keys(people).length));
  out.push("");
  out.push("Без посилання в події: " + noLink);
  if (noLink) {
    out.push("   Це вступ через головне посилання каналу — реклама, пошук, переслали.");
    out.push("   Такого вступу не привʼяжеш: Telegram не каже, звідки людина прийшла.");
  }

  var links = Object.keys(byLink).sort(function (a, b) { return byLink[b] - byLink[a]; });
  out.push("");
  out.push("Вступів за конкретним посиланням: " + (total - noLink) +
           " (різних посилань: " + links.length + ")");
  for (var k = 0; k < Math.min(links.length, max); k++) {
    out.push("   " + byLink[links[k]] + "× " + links[k] +
             (known[links[k]] ? "  ← є в таблиці (мало привʼязатись!)" : "  ← у таблиці такого немає"));
  }
  if (links.length > max) out.push("   … і ще " + (links.length - max));

  Logger.log(out.join("\n"));
  return out.join("\n");
}


// Чому окремо від testTelegramBot: той перевіряє бота й канал з боку
// Telegram. А тут головне питання інше — чи доходить повідомлення про
// вступ до НАШОГО коду. Між Telegram і таблицею стоїть doPost у Code.gs,
// і саме там найчастіше обрив: рядок передачі оновлень легко втратити,
// перевставляючи файл.
function testTgJoinPath() {
  var out = ["🔎 ШЛЯХ «КЛІЄНТ ВСТУПИВ → ТАБЛИЦЯ → ЗВІТ»", ""];
  var props = PropertiesService.getScriptProperties();

  // 1. Вебхук
  var wh = tgApi_("getWebhookInfo", {});
  var want = getTgTrackUrl_() + "?tghook=" + tgHookSecret_();
  if (!wh.ok) {
    out.push("❌ Не вдалось запитати стан вебхука: " + tgExplainTgError_(wh.description));
  } else {
    var w = wh.result || {};
    out.push((w.url ? "✅" : "❌") + " Вебхук: " + (w.url || "не встановлено — запустіть setTelegramWebhook()"));
    if (w.url && w.url !== want) {
      out.push("   ⚠️ Адреса не та, що зараз у проєкті. Запустіть setTelegramWebhook() ще раз.");
    }
    if (w.pending_update_count) out.push("   ⏳ У черзі невручених: " + w.pending_update_count);
    if (w.last_error_message) {
      out.push("   ❌ Остання помилка доставки: " + w.last_error_message +
               (w.last_error_date ? " (" + Utilities.formatDate(new Date(w.last_error_date * 1000),
                Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm") + ")" : ""));
    }
    var allowed = (w.allowed_updates || []).join(", ");
    if (allowed) out.push("   Типи подій: " + allowed);
  }

  // 2. Чи доходить POST до нашого коду (найчастіший обрив)
  var before = tgStr_(props.getProperty("TG_PROBE_AT"));
  try {
    UrlFetchApp.fetch(want, {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      payload: JSON.stringify({update_id: Date.now(), tgprobe: true})
    });
  } catch (err) { out.push("   ⚠️ Не вдалось надіслати пробний запит: " + err); }
  var after = tgStr_(PropertiesService.getScriptProperties().getProperty("TG_PROBE_AT"));
  if (after && after !== before) {
    out.push("✅ Оновлення доходять до коду (пробний запит прийнято " + after + ")");
  } else {
    out.push("❌ Пробний запит НЕ дійшов до handleTelegramUpdate.");
    out.push("   Найімовірніше, у Code.gs у функції doPost немає рядка:");
    out.push("   if (data && data.update_id) return handleTelegramUpdate(data, e);");
    out.push("   Він має стояти одразу після рядка з var data = ...");
    out.push("   Додайте його, зробіть Розгорнути → Нова версія і запустіть цю перевірку ще раз.");
  }

  // 3. Режим посилань
  var mode = (tgProp_("TG_LINK_MODE") || "request").toLowerCase();
  out.push("Режим посилань: " + mode +
           (mode === "request" ? " (бот бачить кожну заявку — нік буде завжди)"
                               : mode === "personal" ? " (вступ одразу; потрібен тип події chat_member)"
                                                     : " ⚠️ персональні посилання вимкнено"));

  // 4. Що зараз у таблицях і в лозі
  var ss = tgSS_(MAIN_FILE_ID);
  var names = [MAIN_SHEET];
  if (typeof TG1C_SHEET === "string" && ss.getSheetByName(TG1C_SHEET)) names.push(TG1C_SHEET);
  var withLink = 0, withNick = 0;
  names.forEach(function (nm) {
    var sh = ss.getSheetByName(nm);
    if (!sh || sh.getMaxColumns() < TG_MAIN_NICK) return;
    var n = sh.getLastRow() - DATA_START + 1;
    if (n < 1) return;
    var v = sh.getRange(DATA_START, TG_MAIN_LINK, n, 2).getValues();
    for (var i = 0; i < n; i++) {
      if (tgStr_(v[i][0])) withLink++;
      if (tgStr_(v[i][1])) withNick++;
    }
  });
  out.push("Рядків із виданим посиланням: " + withLink + " · із ніком клієнта: " + withNick);

  var log = ss.getSheetByName(TG_LOG_SHEET), joined = 0, orphan = 0;
  if (log && log.getLastRow() > 1) {
    var rows = log.getRange(2, 9, log.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < rows.length; r++) {
      var note = tgStr_(rows[r][0]).toLowerCase();
      if (note.indexOf("приєднався") === 0) joined++;
      else if (note.indexOf("не привʼязано") === 0) orphan++;
    }
  }
  out.push("У лозі: вступів з упізнаним клієнтом — " + joined + ", невпізнаних — " + orphan);
  if (!joined && orphan) {
    out.push("   ⚠️ Люди вступають, але за посиланнями, яких немає в таблиці " +
             "(загальне посилання області або переслане). У звіті такі не рахуються.");
  }
  if (!joined && !orphan) {
    out.push("   ℹ️ Жодного вступу ще не зафіксовано. Перевірте вживу: відкрийте кнопку " +
             "на тестовому клієнті й перейдіть за посиланням зі свого Telegram.");
  }

  Logger.log(out.join("\n"));
  return out.join("\n");
}


function testTelegramBot() {
  var out = [];
  if (!tgBotToken_()) {
    Logger.log("❌ TG_BOT_TOKEN не задано — працюють посилання по областях");
    return "TG_BOT_TOKEN не задано";
  }

  var me = tgApi_("getMe", {});
  out.push(me.ok ? "✅ Бот: @" + me.result.username : "❌ Бот: " + tgExplainTgError_(me.description));
  if (!me.ok) { Logger.log(out.join("\n")); return out.join("\n"); }

  var wh = tgApi_("getWebhookInfo", {});
  if (wh.ok) {
    var w = wh.result;
    out.push((w.url ? "✅" : "❌") + " Вебхук: " + (w.url || "не встановлено"));
    out.push("   у черзі: " + (w.pending_update_count || 0) +
             (w.last_error_message ? " · остання помилка: " + w.last_error_message : ""));
    var allowed = (w.allowed_updates || []).join(", ");
    if (allowed && allowed.indexOf("chat_member") === -1) {
      out.push("   ⚠️ chat_member не в allowed_updates — режим \"personal\" не бачитиме вступів");
    }
  }

  // Канали: TG_CHAT_ID + Chat ID по областях
  var props  = PropertiesService.getScriptProperties();
  var chats  = {};
  var common = (props.getProperty("TG_CHAT_ID") || "").trim();
  if (common) chats[common] = "TG_CHAT_ID";
  var map = tgLinksMap_();
  for (var k in map) { if (map[k].chatId) chats[map[k].chatId] = k; }

  if (!Object.keys(chats).length) {
    out.push("❌ Не задано жодного Chat ID каналу (TG_CHAT_ID або колонка C аркуша посилань)");
  }
  for (var id in chats) {
    var chat = tgApi_("getChat", {chat_id: id});
    if (!chat.ok) {
      out.push("❌ Канал " + id + " (" + chats[id] + "): " + tgExplainTgError_(chat.description));
      continue;
    }
    var mem = tgApi_("getChatMember", {chat_id: id, user_id: me.ok ? me.result.id : 0});
    var isAdmin = mem.ok && (mem.result.status === "administrator" || mem.result.status === "creator");
    var canInvite = isAdmin && mem.result.can_invite_users !== false;
    out.push((canInvite ? "✅" : "❌") + " «" + chat.result.title + "» (" + chats[id] + "): " +
             (isAdmin ? (canInvite ? "бот адмін, може створювати запрошення"
                                   : "бот адмін, але БЕЗ права «Запрошувати користувачів»")
                      : "бот НЕ адміністратор каналу"));
  }

  var mode = (props.getProperty("TG_LINK_MODE") || "request").trim();
  out.push("Режим посилань: " + mode +
           (mode === "request" ? " (заявка на вступ — нік видно завжди)" :
            mode === "personal" ? " (одноразове посилання)" : " (персональні вимкнено)"));

  Logger.log(out.join("\n"));
  return out.join("\n");
}

// Разова перевірка звʼязки «посилання → лід»: створює тестове запрошення
// для першого ліда з таблиці і одразу його відкликає.
function testTgPersonalLink() {
  var main = tgSS_(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
  var lastRow = main.getLastRow();
  if (lastRow < DATA_START) { Logger.log("Немає даних"); return; }
  var d = main.getRange(DATA_START, 1, 1, COL.MANAGER).getValues()[0];
  var info = {id: tgStr_(d[COL.ID - 1]), name: tgStr_(d[COL.NAME - 1]), region: tgStr_(d[COL.REGION - 1])};
  if (!info.id) { Logger.log("У першому рядку немає ID"); return; }

  var rec    = tgLinksMap_()[tgNormRegion_(info.region)] || {};
  var chatId = rec.chatId || PropertiesService.getScriptProperties().getProperty("TG_CHAT_ID");
  var link   = tgPersonalLink_(info, rec);
  if (!link) {
    // Питаємо Telegram напряму, щоб назвати причину, а не відсилати кудись
    var why = tgApi_("createChatInviteLink", {chat_id: chatId, name: tgLinkName_(info),
                                              creates_join_request: true});
    Logger.log("❌ Персональне посилання не створено.\n   Причина: " +
               tgExplainTgError_(why.description) +
               "\n   TG_CHAT_ID = " + (chatId || "(не задано)"));
    return;
  }

  Logger.log("✅ Створено: " + link + "\n   назва: " + tgLinkName_(info) +
             "\n   зворотний розбір назви → " + tgLeadIdFromLinkName_(tgLinkName_(info)) +
             " (очікували " + info.id + ")");
  var rv = tgApi_("revokeChatInviteLink", {chat_id: chatId, invite_link: link});
  Logger.log(rv.ok ? "🧹 Тестове посилання відкликано" : "⚠️ Не вдалось відкликати: " + (rv.description || ""));
}
