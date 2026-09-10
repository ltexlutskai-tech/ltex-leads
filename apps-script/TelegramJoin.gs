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

    // Дедуплікація: Telegram повторює доставку, поки не отримає 200
    var cache = CacheService.getScriptCache();
    var key = "tgu_" + data.update_id;
    if (cache.get(key)) return tgOk_();
    cache.put(key, "1", 900);

    if (data.chat_join_request)   tgOnJoinRequest_(data.chat_join_request);
    else if (data.chat_member)    tgOnChatMember_(data.chat_member);
    else if (data.my_chat_member) Logger.log("TG my_chat_member: " + JSON.stringify(data.my_chat_member).substring(0, 300));

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

    var main = tgSS_(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
    if (!main) return;
    var row = tgFindRowByLink_(main, inviteUrl, linkName);

    // Прийшов не за персональним посиланням (напр. за посиланням області)
    if (row === -1) {
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

// Пошук рядка: спершу за точним URL посилання, далі за ID у його назві
function tgFindRowByLink_(main, inviteUrl, linkName) {
  var lastRow = main.getLastRow();
  if (lastRow < DATA_START) return -1;
  var n = lastRow - DATA_START + 1;

  if (inviteUrl) {
    var links = main.getRange(DATA_START, TG_MAIN_LINK, n, 1).getValues();
    for (var i = 0; i < n; i++) {
      if (tgStr_(links[i][0]) === inviteUrl) return DATA_START + i;
    }
  }
  var id = tgLeadIdFromLinkName_(linkName);
  if (id) {
    var row = tgFindRow_(main, COL.ID, DATA_START, id);
    if (row !== -1) return row;
  }
  return -1;
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
  var main = tgSS_(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
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
// ║  5. ПЕРЕВІРКА НАЛАШТУВАНЬ БОТА                           ║
// ╚══════════════════════════════════════════════════════════╝
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
