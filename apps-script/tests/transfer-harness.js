// Пісочниця для ManagerTransfer.gs: перевіряємо саме те, що зламалось у бою —
// масову зміну менеджера при зайнятому замку.
const fs = require("fs");
const vm = require("vm");

function makeEnv(opts = {}) {
  const log = [];
  const viber = [];
  const owners = [];
  const props = {};

  // Файли менеджерів: name → масив ID у файлі
  const files = JSON.parse(JSON.stringify(opts.files));
  // Головна таблиця: рядки з 5-го
  const main = JSON.parse(JSON.stringify(opts.main));

  let lockBusy = opts.lockBusy || (() => false);
  let lockCalls = 0;
  let openCalls = [];

  const COLS = 19;
  function mainRange(row, col, nr, nc) {
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < nr; r++) {
          const line = main[row - 5 + r] || new Array(COLS).fill("");
          out.push(line.slice(col - 1, col - 1 + nc));
        }
        return out;
      },
      getValue() { return (main[row - 5] || [])[col - 1] ?? ""; },
      setValue(v) { (main[row - 5] = main[row - 5] || new Array(COLS).fill(""))[col - 1] = v; },
    };
  }

  const mainSheet = {
    getName: () => "🔒 2026",
    getLastRow: () => 4 + main.length,
    getLastColumn: () => COLS,
    getRange: mainRange,
  };

  const mgrSheet = {
    getLastRow: () => 1 + Object.keys(files).length,
    getRange: (row, col, nr, nc) => ({
      getValues() {
        return Object.keys(files).map((n) => {
          const full = [n, "менеджер", "viber-" + n, "file-" + n, "", "так"];
          return full.slice(col - 1, col - 1 + nc);
        });
      },
    }),
  };

  function mgrFileSheet(name) {
    return {
      getLastRow: () => 4 + files[name].length,
      getLastColumn: () => 18,
      getRange: (row, col, nr, nc) => ({
        getValues() {
          const out = [];
          for (let r = 0; r < nr; r++) {
            const id = files[name][row - 5 + r];
            const line = new Array(18).fill("");
            line[0] = id ?? "";
            out.push(line.slice(col - 1, col - 1 + nc));
          }
          return out;
        },
      }),
      deleteRow: (r) => { files[name].splice(r - 5, 1); },
    };
  }

  const sandbox = {
    console,
    Logger: { log: (m) => log.push(String(m)) },
    Utilities: { formatDate: () => "01.01.2026" },
    Session: { getScriptTimeZone: () => "Europe/Kyiv" },
    SpreadsheetApp: {
      openById(id) {
        openCalls.push(id);
        if (id.startsWith("file-")) {
          const name = id.slice(5);
          return { getSheets: () => [mgrFileSheet(name)] };
        }
        return {
          getSheetByName: (n) => (n === "⚙️ Менеджери" ? mgrSheet : mainSheet),
          getSheets: () => [mainSheet],
        };
      },
      flush() {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
        getProperties: () => ({ ...props }),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { lockCalls++; return !lockBusy(lockCalls); },
        releaseLock: () => {},
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }),
    },
    // Заглушки того, що живе в Code.gs
    getManagers: () => {
      const out = {};
      Object.keys(files).forEach((n) => { out[n] = { fileId: "file-" + n, viberId: "viber-" + n }; });
      return out;
    },
    syncToManager: (rowData, rowId, fileId, toName) => { files[toName].push(rowId); },
    sendViber: (id, text) => viber.push({ id, text }),
    notifyOwners: (text) => owners.push(text),
    generateId: () => "NEW-ID",
    pushLeadToLtexCrm: () => {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require("path").join(__dirname, "..", "ManagerTransfer.gs"), "utf8"), sandbox, { filename: "ManagerTransfer.gs" });

  return { sandbox, log, viber, owners, props, files, main, mainSheet,
           setLockBusy: (fn) => { lockBusy = fn; },
           openCalls, resetOpens: () => { openCalls.length = 0; } };
}

module.exports = { makeEnv };
