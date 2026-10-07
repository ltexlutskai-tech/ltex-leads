// Пісочниця для TgHistoryExport.gs: перевіряємо, які аркуші код бере і які
// рядки журналу відправляє. І те, і те вже підводило нас тихо — без помилки на
// екрані, просто з неповними цифрами у звіті.
const fs = require("fs");
const vm = require("vm");

/**
 * @param {object} opts
 *   sheets: [{name, rows}] — rows для журналу це масиви по 9 колонок
 *   props:  початкові script properties
 *   post:   (payload) => відповідь API; за замовчуванням усе прийнято
 */
function makeEnv(opts = {}) {
  const log = [];
  const props = Object.assign({}, opts.props || {});
  const posts = [];

  const sheets = (opts.sheets || []).map((s) => {
    const rows = s.rows || [];
    return {
      getName: () => s.name,
      // 1 — заголовок, дані з 2-го
      getLastRow: () => (rows.length ? rows.length + 1 : 1),
      getLastColumn: () => 9,
      getRange: (row, col, nr, nc) => ({
        getValues() {
          const out = [];
          for (let r = 0; r < nr; r++) {
            const line = rows[row - 2 + r] || new Array(9).fill("");
            out.push(line.slice(col - 1, col - 1 + nc));
          }
          return out;
        },
      }),
    };
  });

  const sandbox = {
    Logger: { log: (m) => log.push(String(m)) },
    SpreadsheetApp: {
      openById: () => ({
        getSheets: () => sheets,
        getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
      }),
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        const payload = JSON.parse(params.payload);
        posts.push({ url, payload });
        const res = opts.post
          ? opts.post(payload, posts.length)
          : {
              ok: true,
              received: payload.rows.length,
              created: payload.rows.length,
              ignored: 0,
              unmatched: 0,
              duplicates: 0,
              skipped: 0,
            };
        return {
          getResponseCode: () => res.code || 200,
          getContentText: () => JSON.stringify(res),
        };
      },
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => { throw new Error("не треба"); } },
    console,
  };
  sandbox.global = sandbox;

  // Те, що TgHistoryExport.gs бере з сусідніх файлів.
  const prelude = `
    var MAIN_FILE_ID = "main";
    var TG_LOG_SHEET = "_tg_log";
    var DATA_START = 5;
    var COL = {ID: 1, PHONE: 7};
    var TG_MAIN_STATUS = 21, TG_MAIN_DATE = 22, TG_MAIN_LINK = 23,
        TG_MAIN_NICK = 24, TG_MAIN_JOINED = 25, TG_MAIN_TGID = 26;
    function tgStr_(v) { return (v === null || v === undefined) ? "" : String(v).trim(); }
    function tgProp_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
    function tgSetProp_(k, v) {
      var p = PropertiesService.getScriptProperties();
      if (v === "" || v === null || v === undefined) p.deleteProperty(k);
      else p.setProperty(k, String(v));
    }
    function tgSS_(id) { return SpreadsheetApp.openById(id); }
    function tgEcoApiBase_() { return "https://new.ltex.com.ua"; }
    function tgEcoApiSecret_() { return "secret"; }
  `;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(prelude, ctx);
  vm.runInContext(
    fs.readFileSync(__dirname + "/../TgHistoryExport.gs", "utf8"),
    ctx,
    { filename: "TgHistoryExport.gs" },
  );

  // Дата, створена поза пісочницею, НЕ проходить `instanceof Date` усередині —
  // це дві різні функції Date. Код перевіряє саме так (і правильно: Apps Script
  // віддає з клітинки справжній Date), тож переносимо дати в реальність
  // пісочниці, інакше тест перевіряв би артефакт, а не код.
  const mkDate = vm.runInContext("(function(ms){return new Date(ms)})", ctx);
  for (const s of opts.sheets || []) {
    for (const r of s.rows || []) {
      for (let i = 0; i < r.length; i++) {
        if (r[i] instanceof Date) r[i] = mkDate(r[i].getTime());
      }
    }
  }

  return { ctx, log, props, posts, run: (code) => vm.runInContext(code, ctx) };
}

module.exports = { makeEnv };
