/**
 * ═══════════════════════════════════════════════════════════════════
 *  L-TEX | Розширена статистика клієнтської бази
 * ═══════════════════════════════════════════════════════════════════
 *  Встановлення: у таблиці CRM → Розширення → Apps Script →
 *  вставте цей файл повністю, збережіть, перезавантажте таблицю.
 *  З'явиться меню «📊 L-TEX Звіти».
 *
 *  Джерело даних: аркуші, перелічені в CFG.DATA_SHEETS (зараз — «2026»).
 *
 *  Що створює скрипт:
 *   📋 Реєстр            — плоский список УСІХ клієнтів з аркушів-джерел
 *                          (основа для всіх звітів і зведених таблиць)
 *   📍 Області × Місяці  — матриця: області в рядках, місяці в колонках,
 *                          фільтри «Рік», «Статус», «Менеджер», рахується
 *                          формулами в реальному часі
 *   👥 Менеджери × Місяці — та сама матриця в розрізі менеджерів,
 *                          фільтри «Рік», «Статус», «Область»
 *   🌳 Ієрархія          — область → місяць → список клієнтів з датами
 *                          (групи рядків, які можна розгортати)
 *   📊 Дашборд           — загальні показники, динаміка по місяцях,
 *                          топ областей, канали, менеджери
 *   🔀 Зведена           — звичайна зведена таблиця Google Sheets поверх
 *                          Реєстру: поля можна компонувати самостійно
 * ═══════════════════════════════════════════════════════════════════
 */

var CFG = {
  REGISTRY:   '📋 Реєстр',
  MATRIX:     '📍 Області × Місяці',
  MATRIX_MGR: '👥 Менеджери × Місяці',
  TREE:       '🌳 Ієрархія',
  DASH:       '📊 Дашборд',
  PIVOT:      '🔀 Зведена',

  // Аркуші-джерела даних. Якщо список НЕ порожній — беремо клієнтів ТІЛЬКИ
  // з цих аркушів. Якщо порожній ([]) — скануємо всі аркуші автоматично.
  // Щоб додати архів 2025 — допишіть: ['2026', '2025']
  DATA_SHEETS: ['2026'],

  // скільки перших рядків аркуша сканувати в пошуках рядка заголовків
  HEADER_SCAN_ROWS: 6,

  // синоніми заголовків колонок (порівнюються без пробілів/розділових знаків,
  // у нижньому регістрі): так скрипт сам знаходить потрібні колонки
  // на кожному аркуші, навіть якщо порядок колонок різний
  ALIASES: {
    name:     ['імя', 'піб', 'клієнт', 'name', 'фіо', 'имя', 'фио', 'клиент'],
    phone:    ['тел', 'phone', 'номер', 'моб', 'мобільний'],
    region:   ['обл', 'регіон', 'регион', 'region'],
    city:     ['city', 'населенийпункт'],
    date:     ['date'],
    status:   ['status'],
    activity: ['activity'],
    channel:  ['джерело', 'источник', 'source'],
    category: ['category'],
    manager:  ['manager', 'відповідальний', 'ответственный']
  },

  // збіг також зараховується, якщо заголовок ПОЧИНАЄТЬСЯ з цих слів:
  // «Дата звернення», «Ім'я клієнта», «Телефон 1», «Канал пошуку» тощо
  PREFIXES: {
    name:     ['імя', 'имя', 'піб', 'фіо', 'фио', 'клієнт', 'клиент'],
    phone:    ['телефон', 'номертел', 'номер'],
    region:   ['область'],
    city:     ['місто', 'город'],
    date:     ['дата'],
    status:   ['статус'],
    activity: ['активн'],
    channel:  ['канал', 'джерело', 'источник'],
    category: ['категорі', 'категория'],
    manager:  ['менеджер']
  },

  OBLASTS: [
    'Вінницька', 'Волинська', 'Дніпропетровська', 'Донецька', 'Житомирська',
    'Закарпатська', 'Запорізька', 'Івано-Франківська', 'Київська',
    'Кіровоградська', 'Луганська', 'Львівська', 'Миколаївська', 'Одеська',
    'Полтавська', 'Рівненська', 'Сумська', 'Тернопільська', 'Харківська',
    'Херсонська', 'Хмельницька', 'Черкаська', 'Чернівецька', 'Чернігівська'
  ],

  MONTHS_SHORT: ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер',
                 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'],
  MONTHS_FULL:  ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
                 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'],

  // палітра в стилі наявної таблиці
  C_DARK:   '#1f3864',
  C_MID:    '#2e75b6',
  C_LIGHT:  '#deeaf6',
  C_LIGHT2: '#eef4fb',
  C_GRAY:   '#8a8a8a'
};

// колонки Реєстру (1-based)
var RC = { DATE: 1, YEAR: 2, MONTH_N: 3, MONTH: 4, REGION: 5, CITY: 6,
           NAME: 7, PHONE: 8, STATUS: 9, ACTIVITY: 10, CHANNEL: 11,
           CATEGORY: 12, MANAGER: 13, SHEET: 14, ROW: 15 };
var RC_TOTAL = 15;
var REGISTRY_HEADER = ['Дата', 'Рік', '№ міс.', 'Місяць', 'Область', 'Місто',
                       "Ім'я", 'Телефон', 'Статус', 'Активність', 'Канал',
                       'Категорія', 'Менеджер', 'Аркуш', 'Рядок'];

// ═══════════════════════════════════════════════════════════════════
// МЕНЮ
// ═══════════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 L-TEX Звіти')
    .addItem('🔄 Оновити всі звіти', 'rebuildAll')
    .addItem('🔍 Діагностика даних', 'showDiagnostics')
    .addSeparator()
    .addItem('♻️ Скинути зведену таблицю', 'resetPivot')
    .addSeparator()
    .addItem('⚡ Увімкнути автооновлення', 'enableAutoUpdate')
    .addItem('⛔ Вимкнути автооновлення', 'disableAutoUpdate')
    .addSeparator()
    .addItem('ℹ️ Довідка', 'showHelp')
    .addToUi();
}

function showHelp() {
  SpreadsheetApp.getUi().alert(
    'L-TEX Звіти — довідка',
    '📋 Реєстр — усі клієнти з усіх аркушів одним списком. Має фільтр:\n' +
    'можна сортувати і відбирати клієнтів прямо тут.\n\n' +
    '📍 Області × Місяці — фільтри Рік / Статус / Активність / Менеджер\n' +
    'у верхньому рядку, цифри перерахуються миттєво (формули).\n\n' +
    '👥 Менеджери × Місяці — те саме в розрізі менеджерів,\n' +
    'з фільтрами Активність та Область.\n\n' +
    '🌳 Ієрархія — натискайте «+» ліворуч, щоб розгорнути область\n' +
    'і побачити клієнтів по місяцях з датами.\n\n' +
    '🔀 Зведена — звичайна зведена таблиця: натисніть «Змінити» і\n' +
    'компонуйте поля (рядки/стовпці/значення/фільтри) самостійно.\n' +
    'Кнопка «Скинути зведену» повертає стандартний вигляд.\n\n' +
    '⚡ Автооновлення — Реєстр та Ієрархія перебудовуються автоматично\n' +
    'після змін у базі (не частіше, ніж раз на 3 хв), повна перебудова —\n' +
    'щогодини. Формульні звіти підхоплюють зміни Реєстру миттєво.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ═══════════════════════════════════════════════════════════════════
// ГОЛОВНА ФУНКЦІЯ
// ═══════════════════════════════════════════════════════════════════

function rebuildAll() {
  var ss = SpreadsheetApp.getActive();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // вже виконується — виходимо
  try {
    ss.toast('Збираю дані…', 'L-TEX Звіти', 60);
    var model = collectData(ss);

    if (!model.rows.length) {
      SpreadsheetApp.getUi().alert(
        'L-TEX Звіти',
        'Не знайдено жодного клієнта в аркушах-джерелах (' +
        (CFG.DATA_SHEETS.join(', ') || 'усі аркуші') + ').\n\n' +
        'Відкрийте меню «📊 L-TEX Звіти → 🔍 Діагностика даних», щоб побачити, ' +
        'які колонки розпізнано на кожному аркуші.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }

    ss.toast('Будую 📋 Реєстр (' + model.rows.length + ' клієнтів)…', 'L-TEX Звіти', 60);
    buildRegistry(ss, model);

    ss.toast('Будую 📍 Області × Місяці…', 'L-TEX Звіти', 60);
    buildMatrix(ss, model);

    ss.toast('Будую 👥 Менеджери × Місяці…', 'L-TEX Звіти', 60);
    buildMatrixManagers(ss, model);

    ss.toast('Будую 🌳 Ієрархію…', 'L-TEX Звіти', 60);
    buildTree(ss, model);

    ss.toast('Будую 📊 Дашборд…', 'L-TEX Звіти', 60);
    buildDashboard(ss, model);

    ensurePivot(ss);

    ss.toast('Готово! Оброблено клієнтів: ' + model.rows.length, 'L-TEX Звіти', 8);
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════════
// ЗБІР ДАНИХ
// ═══════════════════════════════════════════════════════════════════

function collectData(ss) {
  var rows = [];
  getDataSheets(ss).forEach(function (sheet) {
    var name = sheet.getName();
    // якщо в назві аркуша є рік («2026», «🔒 2026»…) — використовуємо його
    // як запасний рік для рядків без дати
    var ym = name.match(/(19|20)\d{2}/);
    var sheetYear = ym ? +ym[0] : null;

    var header = findHeader(sheet);
    if (!header) return; // не аркуш із клієнтами (наприклад, стара «Статистика»)

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= header.row) return;

    var values = sheet.getRange(header.row + 1, 1, lastRow - header.row, lastCol).getValues();
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      var get = function (field) {
        var c = header.cols[field];
        return c === undefined ? '' : String(v[c] === null ? '' : v[c]).trim();
      };
      var rawName  = get('name');
      var rawPhone = get('phone');
      if (!rawName && !rawPhone) continue; // порожній рядок

      var d = parseDateValue(header.cols.date === undefined ? '' : v[header.cols.date]);
      var manager = get('manager') || name; // якщо колонки нема — назва аркуша

      rows.push({
        date: d,
        year: d ? d.getFullYear() : (sheetYear || ''),
        monthN: d ? d.getMonth() + 1 : '',
        month: d ? monthKey(d) : 'Без дати',
        region: normRegion(get('region')),
        city: get('city'),
        name: rawName,
        phone: rawPhone,
        phoneKey: normPhone(rawPhone),
        status: normStatus(get('status')),
        activity: normLabel(get('activity'), 'Без активності'),
        channel: get('channel'),
        category: get('category'),
        manager: manager,
        sheet: name,
        srcRow: header.row + 1 + i
      });
    }
  });

  // новіші зверху
  rows.sort(function (a, b) {
    var ta = a.date ? a.date.getTime() : 0;
    var tb = b.date ? b.date.getTime() : 0;
    return tb - ta;
  });

  // дублікати телефонів
  var phoneCount = {};
  rows.forEach(function (r) {
    if (r.phoneKey) phoneCount[r.phoneKey] = (phoneCount[r.phoneKey] || 0) + 1;
  });
  var dupRows = 0;
  rows.forEach(function (r) {
    if (r.phoneKey && phoneCount[r.phoneKey] > 1) dupRows++;
  });

  return {
    rows: rows,
    dupRows: dupRows,
    years: uniqSorted(rows.map(function (r) { return r.year; })).reverse(),
    statuses: tallyKeysDesc(rows, function (r) { return r.status; }),
    activities: tallyKeysDesc(rows, function (r) { return r.activity; }),
    channels: tallyKeysDesc(rows, function (r) { return r.channel; }),
    managers: tallyKeysDesc(rows, function (r) { return r.manager; }),
    regions: tallyKeysDesc(rows, function (r) { return r.region; }),
    months: uniqSorted(rows.map(function (r) { return r.month; }))
      .filter(function (m) { return m !== 'Без дати'; })
  };
}

function reportNameSet() {
  var names = {};
  [CFG.REGISTRY, CFG.MATRIX, CFG.MATRIX_MGR, CFG.TREE, CFG.DASH, CFG.PIVOT]
    .forEach(function (n) { names[n] = true; });
  return names;
}

/**
 * Аркуші-джерела: явний список із CFG.DATA_SHEETS або всі, крім звітних.
 * Назва з DATA_SHEETS шукається спершу точно, а потім як ЧАСТИНА назви
 * аркуша — тому запис '2026' знаходить і аркуш «🔒 2026».
 */
function getDataSheets(ss) {
  if (CFG.DATA_SHEETS && CFG.DATA_SHEETS.length) {
    var reportNames = reportNameSet();
    var result = [], seen = {};
    CFG.DATA_SHEETS.forEach(function (n) {
      var key = String(n);
      var sh = ss.getSheetByName(key);
      if (!sh) {
        sh = ss.getSheets().filter(function (s) {
          return !reportNames[s.getName()] && s.getName().indexOf(key) !== -1;
        })[0] || null;
      }
      if (sh && !seen[sh.getSheetId()]) {
        seen[sh.getSheetId()] = true;
        result.push(sh);
      }
    });
    return result;
  }
  var reportNames2 = reportNameSet();
  return ss.getSheets().filter(function (sh) {
    return !reportNames2[sh.getName()];
  });
}

/**
 * Пошук рядка заголовків: потрібна колонка Телефон + хоча б одна з
 * колонок Ім'я або Дата (в одному рядку, серед перших рядків аркуша).
 */
function findHeader(sheet) {
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastCol < 2 || lastRow < 2) return null;

  var scan = Math.min(CFG.HEADER_SCAN_ROWS, lastRow);
  var values = sheet.getRange(1, 1, scan, lastCol).getValues();

  for (var r = 0; r < scan; r++) {
    var cols = {};
    for (var c = 0; c < lastCol; c++) {
      var norm = normHeaderCell(values[r][c]);
      if (!norm) continue;
      var field = matchHeaderField(norm);
      if (field && cols[field] === undefined) cols[field] = c;
    }
    if (cols.phone !== undefined &&
        (cols.name !== undefined || cols.date !== undefined)) {
      return { row: r + 1, cols: cols };
    }
  }
  return null;
}

/** До якого поля належить нормалізований заголовок (точний збіг або префікс) */
function matchHeaderField(norm) {
  for (var field in CFG.ALIASES) {
    if (CFG.ALIASES[field].indexOf(norm) !== -1) return field;
  }
  for (var f2 in CFG.PREFIXES) {
    var prefixes = CFG.PREFIXES[f2];
    for (var i = 0; i < prefixes.length; i++) {
      if (norm.indexOf(prefixes[i]) === 0) return f2;
    }
  }
  return null;
}

// ── нормалізація ────────────────────────────────────────────────────

function normHeaderCell(v) {
  return String(v || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
}

function normRegion(raw) {
  var s = String(raw || '').trim();
  if (!s) return 'Не вказано';
  var low = s.toLowerCase()
    .replace(/область|обл\.?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!low) return 'Не вказано';
  for (var i = 0; i < CFG.OBLASTS.length; i++) {
    var root = CFG.OBLASTS[i].toLowerCase().replace(/ька$/, '');
    if (low.indexOf(root) === 0) return CFG.OBLASTS[i];
  }
  if (low === 'київ' || low === 'киев' || low === 'мкиїв' || low === 'м київ') return 'м. Київ';
  if (low === 'крим' || low.indexOf('ар крим') === 0 || low.indexOf('автономна') === 0) return 'АР Крим';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normStatus(raw) {
  return normLabel(raw, 'Без статусу');
}

function normLabel(raw, fallback) {
  var s = String(raw || '').trim();
  if (!s) return fallback;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normPhone(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : d;
}

function parseDateValue(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  var s = String(v || '').trim();
  if (!s) return null;
  var m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (m) {
    var y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, +m[2] - 1, +m[1]);
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

function monthKey(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

// ── дрібні утиліти ──────────────────────────────────────────────────

function uniqSorted(arr) {
  var seen = {};
  arr.forEach(function (v) { if (v !== '' && v !== null) seen[v] = true; });
  return Object.keys(seen).sort();
}

/** Список унікальних значень, відсортований за кількістю (спадання) */
function tallyKeysDesc(rows, keyFn) {
  var t = {};
  rows.forEach(function (r) {
    var k = keyFn(r);
    if (k === '' || k === null || k === undefined) return;
    t[k] = (t[k] || 0) + 1;
  });
  return Object.keys(t).sort(function (a, b) { return t[b] - t[a]; });
}

function getOrCreateSheet(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

/** Повністю очищає аркуш (вміст, формати, фільтр, смуги, умовне форматування) */
function wipeSheet(sh) {
  var f = sh.getFilter();
  if (f) f.remove();
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.clear();
  sh.setConditionalFormatRules([]);
  sh.clearNotes();
}

function ensureGrid(sh, rows, cols) {
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}

function regRef(colIndex) {
  var letter = columnLetter(colIndex);
  return "'" + CFG.REGISTRY + "'!$" + letter + "$2:$" + letter;
}

function columnLetter(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

// ═══════════════════════════════════════════════════════════════════
// 📋 РЕЄСТР — плоска база всіх клієнтів
// ═══════════════════════════════════════════════════════════════════

function buildRegistry(ss, model) {
  var sh = getOrCreateSheet(ss, CFG.REGISTRY);
  wipeSheet(sh);

  var n = model.rows.length;
  // запас рядків, щоб діапазон-джерело зведеної таблиці покривав нових
  // клієнтів без перестворення зведеної (і без втрати компоновки)
  ensureGrid(sh, n + 2 + 2000, RC_TOTAL);

  var out = model.rows.map(function (r) {
    return [r.date || '', r.year, r.monthN, r.month, r.region, r.city, r.name,
            r.phone, r.status, r.activity, r.channel, r.category, r.manager,
            r.sheet, r.srcRow];
  });

  sh.getRange(1, 1, 1, RC_TOTAL).setValues([REGISTRY_HEADER])
    .setBackground(CFG.C_DARK).setFontColor('#ffffff').setFontWeight('bold');
  if (n) {
    sh.getRange(2, 1, n, RC_TOTAL).setValues(out);
    sh.getRange(2, RC.DATE, n, 1).setNumberFormat('dd.mm.yyyy');
    sh.getRange(2, RC.PHONE, n, 1).setNumberFormat('@'); // телефони як текст
  }

  sh.setFrozenRows(1);
  sh.getRange(1, 1, n + 1, RC_TOTAL).createFilter();
  sh.setColumnWidths(RC.YEAR, 2, 50);
  sh.setColumnWidth(RC.NAME, 180);
  sh.setColumnWidth(RC.REGION, 140);
  sh.autoResizeColumns(RC.MONTH, 1);

  // смугасте виділення для читабельності
  if (n) {
    sh.getRange(2, 1, n, RC_TOTAL)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  }
}

// ═══════════════════════════════════════════════════════════════════
// ЖИВІ МАТРИЦІ «розріз × місяці» з фільтрами
// ═══════════════════════════════════════════════════════════════════

/** 📍 Області в рядках; фільтри: Рік, Статус, Менеджер */
function buildMatrix(ss, model) {
  var regions = model.regions.filter(function (r) { return r !== 'Не вказано'; });
  if (model.regions.indexOf('Не вказано') !== -1) regions.push('Не вказано');

  buildMatrixSheet(ss, {
    sheetName: CFG.MATRIX,
    rowTitle: 'Область',
    rowValues: regions,
    rowRegCol: RC.REGION,
    filters: [
      { label: 'Рік:',        list: model.years.map(String), regCol: RC.YEAR },
      { label: 'Статус:',     list: model.statuses,          regCol: RC.STATUS },
      { label: 'Активність:', list: model.activities,        regCol: RC.ACTIVITY },
      { label: 'Менеджер:',   list: model.managers,          regCol: RC.MANAGER }
    ]
  });
}

/** 👥 Менеджери в рядках; фільтри: Рік, Статус, Область */
function buildMatrixManagers(ss, model) {
  buildMatrixSheet(ss, {
    sheetName: CFG.MATRIX_MGR,
    rowTitle: 'Менеджер',
    rowValues: model.managers,
    rowRegCol: RC.MANAGER,
    filters: [
      { label: 'Рік:',        list: model.years.map(String), regCol: RC.YEAR },
      { label: 'Статус:',     list: model.statuses,          regCol: RC.STATUS },
      { label: 'Активність:', list: model.activities,        regCol: RC.ACTIVITY },
      { label: 'Область:',    list: model.regions,           regCol: RC.REGION }
    ]
  });
}

/**
 * Універсальна матриця: значення розрізу в рядках, місяці в колонках,
 * до трьох фільтрів у верхньому рядку. Все рахується формулами SUMPRODUCT
 * поверх Реєстру — оновлюється в реальному часі.
 */
function buildMatrixSheet(ss, opts) {
  var sh = getOrCreateSheet(ss, opts.sheetName);
  wipeSheet(sh);
  // скидаємо старі об'єднання клітинок від попередньої побудови
  sh.getRange(1, 1, 1, sh.getMaxColumns()).breakApart();

  var rows = opts.rowValues;
  var firstDataRow = 4;
  var lastDataRow = firstDataRow + rows.length - 1;
  var totalRow = lastDataRow + 1;
  ensureGrid(sh, totalRow + 2, 15);

  // ── рядок 1: до чотирьох фільтрів (значення — об'єднані клітинки) ──
  var filterCells = ['$B$1', '$E$1', '$H$1', '$K$1'];
  var filterDefs = opts.filters.slice(0, 4);
  var labelCols = [1, 4, 7, 10];
  var mergeSpec = [[2, 2], [5, 2], [8, 2], [11, 2]]; // [колонка, ширина об'єднання]

  var filterTerms = '';
  filterDefs.forEach(function (fd, i) {
    sh.getRange(1, labelCols[i]).setValue(fd.label).setFontWeight('bold');
    var cell = sh.getRange(1, mergeSpec[i][0], 1, mergeSpec[i][1]).merge();
    cell.setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(['Всі'].concat(fd.list), true)
        .setAllowInvalid(false).build()
    );
    cell.setValue('Всі').setBackground(CFG.C_LIGHT).setHorizontalAlignment('center');
    filterTerms += '*((' + filterCells[i] + '="Всі")+((' + regRef(fd.regCol) +
                   '&"")=(' + filterCells[i] + '&"")))';
  });
  sh.getRange(1, 13).setValue('← фільтри: цифри перерахуються миттєво')
    .setFontColor(CFG.C_GRAY).setFontStyle('italic');

  // ── рядок 2: службові номери місяців (прихований) ──
  var nums = [[]];
  for (var m = 1; m <= 12; m++) nums[0].push(m);
  sh.getRange(2, 2, 1, 12).setValues(nums);

  // ── рядок 3: заголовки ──
  var head = [opts.rowTitle].concat(CFG.MONTHS_SHORT).concat(['Разом']);
  sh.getRange(3, 1, 1, 14).setValues([head])
    .setBackground(CFG.C_MID).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center');
  sh.getRange('A3').setHorizontalAlignment('left');

  // ── дані ──
  if (rows.length) {
    sh.getRange(firstDataRow, 1, rows.length, 1)
      .setValues(rows.map(function (r) { return [r]; }));

    var formulas = [];
    for (var i = 0; i < rows.length; i++) {
      var row = firstDataRow + i;
      var f = [];
      for (var c = 0; c < 12; c++) {
        var colL = columnLetter(2 + c);
        f.push(
          '=SUMPRODUCT((' + regRef(opts.rowRegCol) + '=$A' + row + ')' +
          '*(' + regRef(RC.MONTH_N) + '=' + colL + '$2)' +
          filterTerms + ')'
        );
      }
      f.push('=SUM(B' + row + ':M' + row + ')');
      formulas.push(f);
    }
    sh.getRange(firstDataRow, 2, rows.length, 13).setFormulas(formulas);

    // підсумковий рядок
    sh.getRange(totalRow, 1).setValue('Разом');
    var tf = [[]];
    for (var c2 = 0; c2 < 13; c2++) {
      var L = columnLetter(2 + c2);
      tf[0].push('=SUM(' + L + firstDataRow + ':' + L + lastDataRow + ')');
    }
    sh.getRange(totalRow, 2, 1, 13).setFormulas(tf);
    sh.getRange(totalRow, 1, 1, 14)
      .setBackground(CFG.C_DARK).setFontColor('#ffffff').setFontWeight('bold');

    // оформлення
    sh.getRange(firstDataRow, 2, rows.length + 1, 13)
      .setHorizontalAlignment('center').setNumberFormat('0;-0;"–"');
    sh.getRange(firstDataRow, 14, rows.length, 1).setFontWeight('bold');
    sh.getRange(firstDataRow, 1, rows.length, 14)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

    // теплова мапа
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint('#ffffff')
      .setGradientMaxpoint(CFG.C_MID)
      .setRanges([sh.getRange(firstDataRow, 2, rows.length, 12)])
      .build();
    sh.setConditionalFormatRules([rule]);
  }

  sh.hideRows(2);
  sh.setFrozenRows(3);
  sh.setFrozenColumns(1);
  sh.setColumnWidth(1, 180);
  for (var w = 2; w <= 13; w++) sh.setColumnWidth(w, 52);
  sh.setColumnWidth(14, 70);
}

// ═══════════════════════════════════════════════════════════════════
// 🌳 ІЄРАРХІЯ — область → місяць → клієнти
// ═══════════════════════════════════════════════════════════════════

function buildTree(ss, model) {
  // групи рядків найпростіше скидати перестворенням аркуша
  var old = ss.getSheetByName(CFG.TREE);
  var index = old ? old.getIndex() - 1 : ss.getNumSheets();
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(CFG.TREE, index);

  var NCOL = 9;
  var HEADERS = ['Область / Місяць', 'Дата', "Ім'я", 'Телефон', 'Місто',
                 'Статус', 'Активність', 'Канал', 'Менеджер'];

  // групуємо: область → місяць → клієнти
  var byRegion = {};
  model.rows.forEach(function (r) {
    (byRegion[r.region] = byRegion[r.region] || []).push(r);
  });
  var regionOrder = model.regions.filter(function (r) { return r !== 'Не вказано'; });
  if (byRegion['Не вказано']) regionOrder.push('Не вказано');

  var values = [], bg = [], fw = [], fc = [];
  var groupRanges = []; // [початок, довжина] блоків для групування

  var push = function (row, b, w, c) {
    values.push(row); bg.push(b); fw.push(w); fc.push(c);
  };
  var rowOf = function (arr) { var a = []; for (var i = 0; i < NCOL; i++) a.push(arr[i] || ''); return a; };
  var fill = function (v) { var a = []; for (var i = 0; i < NCOL; i++) a.push(v); return a; };

  push(rowOf(['🌳 Ієрархічний звіт: область → місяць → клієнти']),
       fill(CFG.C_DARK), fill('bold'), fill('#ffffff'));
  push(rowOf(['Натискайте «+» ліворуч, щоб розгорнути область. Оновлено: ' +
              Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm')]),
       fill('#ffffff'), fill('normal'), fill(CFG.C_GRAY));
  push(HEADERS, fill(CFG.C_MID), fill('bold'), fill('#ffffff'));

  regionOrder.forEach(function (region) {
    var list = byRegion[region];
    // область
    push(rowOf([region + '  —  ' + list.length + ' кл.']),
         fill(CFG.C_LIGHT), fill('bold'), fill(CFG.C_DARK));
    var blockStart = values.length + 1; // перший рядок вмісту області (1-based)

    // місяці за зростанням, без дати — в кінець
    var byMonth = {};
    list.forEach(function (r) { (byMonth[r.month] = byMonth[r.month] || []).push(r); });
    var months = Object.keys(byMonth).sort();
    if (byMonth['Без дати']) {
      months = months.filter(function (m) { return m !== 'Без дати'; }).concat(['Без дати']);
    }

    months.forEach(function (mk) {
      var clients = byMonth[mk];
      clients.sort(function (a, b) {
        return (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0);
      });
      push(rowOf(['      ' + monthLabel(mk) + '  —  ' + clients.length]),
           fill(CFG.C_LIGHT2), fill('bold'), fill(CFG.C_MID));
      clients.forEach(function (r) {
        push(['', r.date ? Utilities.formatDate(r.date, ss.getSpreadsheetTimeZone(), 'dd.MM.yyyy') : '—',
              r.name, r.phone, r.city, r.status, r.activity, r.channel, r.manager],
             fill('#ffffff'), fill('normal'), fill('#000000'));
      });
    });

    groupRanges.push([blockStart, values.length + 1 - blockStart]);
  });

  ensureGrid(sh, values.length + 1, NCOL);
  sh.getRange(1, 1, values.length, NCOL).setValues(values)
    .setBackgrounds(bg).setFontWeights(fw).setFontColors(fc);

  sh.setFrozenRows(3);
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 180);
  sh.setColumnWidth(4, 110);
  sh.setColumnWidth(5, 130);
  sh.setColumnWidths(6, 4, 110);
  sh.getRange(1, 4, values.length, 1).setNumberFormat('@');

  // групи рядків: кнопка «+/–» біля рядка з назвою області
  var created = 0;
  sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
  groupRanges.forEach(function (g) {
    if (g[1] > 0) { sh.getRange(g[0], 1, g[1], 1).shiftRowGroupDepth(1); created++; }
  });
  if (created) {
    try { sh.collapseAllRowGroups(); } catch (err) { /* груп нема — ок */ }
  }
}

function monthLabel(mk) {
  if (mk === 'Без дати') return 'Без дати';
  var p = mk.split('-');
  return CFG.MONTHS_FULL[+p[1] - 1] + ' ' + p[0];
}

// ═══════════════════════════════════════════════════════════════════
// 📊 ДАШБОРД — живі показники поверх Реєстру
// ═══════════════════════════════════════════════════════════════════

function buildDashboard(ss, model) {
  var sh = getOrCreateSheet(ss, CFG.DASH);
  wipeSheet(sh);
  ensureGrid(sh, 120, 12);

  var tz = ss.getSpreadsheetTimeZone();
  var years = model.years.slice(0, 2); // дві останні для колонок по роках

  sh.getRange('A1').setValue('📊 Дашборд клієнтської бази L-TEX')
    .setFontSize(14).setFontWeight('bold').setFontColor(CFG.C_DARK);
  sh.getRange('A2').setValue(
    'Оновлено: ' + Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm') +
    '  ·  показники рахуються формулами з аркуша «' + CFG.REGISTRY + '» у реальному часі'
  ).setFontColor(CFG.C_GRAY).setFontStyle('italic');

  var blockHeader = function (row, col, width, title) {
    sh.getRange(row, col, 1, width).setBackground(CFG.C_DARK)
      .setFontColor('#ffffff').setFontWeight('bold');
    sh.getRange(row, col).setValue(title);
  };

  // ── ЛІВА КОЛОНКА (A:D) ──────────────────────────────────────────
  var r = 4;
  blockHeader(r, 1, 4, 'ЗАГАЛЬНІ ПОКАЗНИКИ'); r++;

  var kpi = [
    ['Всього клієнтів', '=COUNTA(' + regRef(RC.PHONE) + ')'],
    ['За поточний місяць', '=SUMPRODUCT((' + regRef(RC.YEAR) + '=YEAR(TODAY()))*(' +
       regRef(RC.MONTH_N) + '=MONTH(TODAY())))'],
    ['За попередній місяць', '=SUMPRODUCT((' + regRef(RC.YEAR) + '=YEAR(EDATE(TODAY(),-1)))*(' +
       regRef(RC.MONTH_N) + '=MONTH(EDATE(TODAY(),-1))))'],
    ['Дублі телефонів *', model.dupRows]
  ];
  model.statuses.forEach(function (s) {
    kpi.push(['Статус: ' + s, '=COUNTIF(' + regRef(RC.STATUS) + ',"' + s.replace(/"/g, '""') + '")']);
  });

  kpi.forEach(function (row) {
    sh.getRange(r, 1).setValue(row[0]);
    if (typeof row[1] === 'string' && row[1].charAt(0) === '=') {
      sh.getRange(r, 2).setFormula(row[1]);
    } else {
      sh.getRange(r, 2).setValue(row[1]);
    }
    sh.getRange(r, 2).setFontWeight('bold').setHorizontalAlignment('center');
    r++;
  });
  sh.getRange(r, 1, 1, 4).merge().setValue('* дублі перераховуються при оновленні звітів')
    .setFontColor(CFG.C_GRAY).setFontStyle('italic').setFontSize(8);
  r += 2;

  // динаміка по місяцях
  blockHeader(r, 1, 4, 'ДИНАМІКА ПО МІСЯЦЯХ'); r++;
  var months = model.months.slice(-24); // останні 24 місяці
  var mStart = r;
  months.forEach(function (mk) {
    sh.getRange(r, 1).setValue(monthLabel(mk));
    sh.getRange(r, 2).setFormula('=COUNTIF(' + regRef(RC.MONTH) + ',"' + mk + '")')
      .setHorizontalAlignment('center');
    r++;
  });
  var mEnd = r - 1;
  if (months.length) {
    var bars = [];
    for (var i = mStart; i <= mEnd; i++) {
      bars.push(['=IF($B' + i + '=0,"",REPT("▇",MAX(1,ROUND(18*$B' + i +
                 '/MAX($B$' + mStart + ':$B$' + mEnd + ')))))']);
    }
    sh.getRange(mStart, 3, bars.length, 1).setFormulas(bars).setFontColor(CFG.C_MID);
  }
  r += 2;

  // менеджери
  blockHeader(r, 1, 4, 'МЕНЕДЖЕРИ'); r++;
  var mgrHead = [''].concat(years.map(String)).concat(['Разом']);
  sh.getRange(r, 1, 1, mgrHead.length).setValues([mgrHead])
    .setFontWeight('bold').setBackground(CFG.C_LIGHT).setHorizontalAlignment('center');
  r++;
  model.managers.forEach(function (mg) {
    var esc = mg.replace(/"/g, '""');
    sh.getRange(r, 1).setValue(mg);
    var f = [];
    years.forEach(function (y) {
      f.push('=COUNTIFS(' + regRef(RC.MANAGER) + ',"' + esc + '",' +
             regRef(RC.YEAR) + ',' + y + ')');
    });
    f.push('=COUNTIF(' + regRef(RC.MANAGER) + ',"' + esc + '")');
    sh.getRange(r, 2, 1, f.length).setFormulas([f]).setHorizontalAlignment('center');
    sh.getRange(r, 1 + f.length).setFontWeight('bold');
    r++;
  });

  // ── ПРАВА КОЛОНКА (F:I) ─────────────────────────────────────────
  var r2 = 4;
  blockHeader(r2, 6, 4, 'ТОП ОБЛАСТЕЙ'); r2++;
  var topRegions = model.regions.slice(0, 15);
  var rStart = r2;
  topRegions.forEach(function (reg) {
    var esc = reg.replace(/"/g, '""');
    sh.getRange(r2, 6).setValue(reg);
    sh.getRange(r2, 7).setFormula('=COUNTIF(' + regRef(RC.REGION) + ',"' + esc + '")')
      .setHorizontalAlignment('center');
    r2++;
  });
  var rEnd = r2 - 1;
  if (topRegions.length) {
    var rbars = [];
    for (var j = rStart; j <= rEnd; j++) {
      rbars.push(['=IF($G' + j + '=0,"",REPT("▇",MAX(1,ROUND(18*$G' + j +
                  '/MAX($G$' + rStart + ':$G$' + rEnd + ')))))']);
    }
    sh.getRange(rStart, 8, rbars.length, 1).setFormulas(rbars).setFontColor(CFG.C_MID);
  }
  r2 += 2;

  // активність
  blockHeader(r2, 6, 4, 'АКТИВНІСТЬ'); r2++;
  var actHead = [''].concat(years.map(String)).concat(['Разом']);
  sh.getRange(r2, 6, 1, actHead.length).setValues([actHead])
    .setFontWeight('bold').setBackground(CFG.C_LIGHT).setHorizontalAlignment('center');
  r2++;
  model.activities.forEach(function (act) {
    var esc = act.replace(/"/g, '""');
    sh.getRange(r2, 6).setValue(act);
    var f = [];
    years.forEach(function (y) {
      f.push('=COUNTIFS(' + regRef(RC.ACTIVITY) + ',"' + esc + '",' +
             regRef(RC.YEAR) + ',' + y + ')');
    });
    f.push('=COUNTIF(' + regRef(RC.ACTIVITY) + ',"' + esc + '")');
    sh.getRange(r2, 7, 1, f.length).setFormulas([f]).setHorizontalAlignment('center');
    sh.getRange(r2, 6 + f.length).setFontWeight('bold');
    r2++;
  });
  r2 += 2;

  // канали
  blockHeader(r2, 6, 4, 'КАНАЛИ'); r2++;
  var chHead = [''].concat(years.map(String)).concat(['Разом']);
  sh.getRange(r2, 6, 1, chHead.length).setValues([chHead])
    .setFontWeight('bold').setBackground(CFG.C_LIGHT).setHorizontalAlignment('center');
  r2++;
  model.channels.forEach(function (ch) {
    var esc = ch.replace(/"/g, '""');
    sh.getRange(r2, 6).setValue(ch);
    var f = [];
    years.forEach(function (y) {
      f.push('=COUNTIFS(' + regRef(RC.CHANNEL) + ',"' + esc + '",' +
             regRef(RC.YEAR) + ',' + y + ')');
    });
    f.push('=COUNTIF(' + regRef(RC.CHANNEL) + ',"' + esc + '")');
    sh.getRange(r2, 7, 1, f.length).setFormulas([f]).setHorizontalAlignment('center');
    sh.getRange(r2, 6 + f.length).setFontWeight('bold');
    r2++;
  });

  sh.setColumnWidth(1, 190);
  sh.setColumnWidths(2, 3, 90);
  sh.setColumnWidth(5, 30);
  sh.setColumnWidth(6, 170);
  sh.setColumnWidths(7, 3, 90);
  sh.setHiddenGridlines(true);
}

// ═══════════════════════════════════════════════════════════════════
// 🔀 ЗВЕДЕНА — стандартна зведена таблиця для самостійної компоновки
// ═══════════════════════════════════════════════════════════════════

/**
 * Створює зведену тільки якщо її ще нема або її джерело більше не покриває
 * дані Реєстру — щоб не стирати компоновку користувача без потреби.
 */
function ensurePivot(ss) {
  var sh = ss.getSheetByName(CFG.PIVOT);
  var reg = ss.getSheetByName(CFG.REGISTRY);
  if (sh && reg) {
    var pts = sh.getPivotTables();
    if (pts.length) {
      var ok = false;
      try {
        var src = pts[0].getSourceDataRange();
        ok = src.getSheet().getName() === CFG.REGISTRY &&
             src.getLastRow() >= reg.getLastRow() &&
             src.getLastColumn() >= RC_TOTAL;
      } catch (err) { ok = false; }
      if (ok) return;
    }
  }
  resetPivot();
}

function resetPivot() {
  var ss = SpreadsheetApp.getActive();
  var reg = ss.getSheetByName(CFG.REGISTRY);
  if (!reg) { rebuildAll(); return; }

  var sh = getOrCreateSheet(ss, CFG.PIVOT);
  sh.getPivotTables().forEach(function (p) { p.remove(); });
  wipeSheet(sh);

  sh.getRange('A1').setValue('🔀 Зведена таблиця — натисніть будь-яку клітинку таблиці і «Змінити», ' +
      'щоб самостійно компонувати поля (рядки, стовпці, значення, фільтри).')
    .setFontColor(CFG.C_GRAY).setFontStyle('italic');

  // відкритий діапазон: нові клієнти в Реєстрі підхоплюються автоматично
  var source = reg.getRange('A1:' + columnLetter(RC_TOTAL));
  var pivot = sh.getRange('A3').createPivotTable(source);
  pivot.addRowGroup(RC.REGION);
  pivot.addRowGroup(RC.MANAGER);
  pivot.addColumnGroup(RC.MONTH);
  pivot.addPivotValue(RC.PHONE, SpreadsheetApp.PivotTableSummarizeFunction.COUNTA)
    .setDisplayName('Клієнтів');
}

// ═══════════════════════════════════════════════════════════════════
// 🔍 ДІАГНОСТИКА — що скрипт бачить на кожному аркуші
// ═══════════════════════════════════════════════════════════════════

var FIELD_LABELS = {
  name: "Ім'я", phone: 'Телефон', region: 'Область', city: 'Місто',
  date: 'Дата', status: 'Статус', activity: 'Активність', channel: 'Канал',
  category: 'Категорія', manager: 'Менеджер'
};

function showDiagnostics() {
  var ss = SpreadsheetApp.getActive();
  var lines = [];

  if (CFG.DATA_SHEETS && CFG.DATA_SHEETS.length) {
    lines.push('Джерела даних (CFG.DATA_SHEETS): ' + CFG.DATA_SHEETS.join(', '));
    var resolvedNames = getDataSheets(ss).map(function (s) { return '«' + s.getName() + '»'; });
    lines.push('Знайдені аркуші: ' +
      (resolvedNames.length ? resolvedNames.join(', ') : '⚠️ ЖОДНОГО — перевірте назви!'));
  } else {
    lines.push('Джерела даних: усі аркуші (автовизначення)');
  }
  lines.push('');

  getDataSheets(ss).forEach(function (sheet) {
    var name = sheet.getName();
    var h = findHeader(sheet);
    if (!h) {
      lines.push('✖ «' + name + '» — колонки НЕ розпізнано.');
      lines.push('   Потрібен рядок заголовків із колонкою «Телефон» та хоча б');
      lines.push('   однією з колонок «Ім\'я» або «Дата» (серед перших ' +
                 CFG.HEADER_SCAN_ROWS + ' рядків).');
      var lastCol = Math.min(sheet.getLastColumn(), 15);
      for (var r = 1; r <= Math.min(2, sheet.getLastRow()); r++) {
        if (lastCol > 0) {
          var vals = sheet.getRange(r, 1, 1, lastCol).getDisplayValues()[0];
          lines.push('   Рядок ' + r + ': [' + vals.join(' | ') + ']');
        }
      }
    } else {
      var mapped = [];
      for (var field in h.cols) {
        mapped.push(FIELD_LABELS[field] + ' → колонка ' + columnLetter(h.cols[field] + 1));
      }
      var dataRows = Math.max(0, sheet.getLastRow() - h.row);
      lines.push('✓ «' + name + '» — заголовки в рядку ' + h.row +
                 ', рядків даних: ' + dataRows);
      lines.push('   ' + mapped.join(', '));
      var missing = [];
      for (var f in FIELD_LABELS) {
        if (h.cols[f] === undefined) missing.push(FIELD_LABELS[f]);
      }
      if (missing.length) lines.push('   Не знайдено (необов\'язково): ' + missing.join(', '));
    }
    lines.push('');
  });

  var esc = lines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  var html = HtmlService.createHtmlOutput(
    '<pre style="font:12px/1.5 monospace;white-space:pre-wrap">' + esc + '</pre>'
  ).setWidth(650).setHeight(450);
  SpreadsheetApp.getUi().showModalDialog(html, '🔍 Діагностика даних L-TEX');
}

// ═══════════════════════════════════════════════════════════════════
// АВТООНОВЛЕННЯ
// ═══════════════════════════════════════════════════════════════════

var TRIGGER_HANDLERS = ['ltexOnChange', 'ltexHourly'];

function enableAutoUpdate() {
  disableAutoUpdate(true);
  var ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('ltexOnChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('ltexHourly').timeBased().everyHours(1).create();
  ss.toast('Автооновлення увімкнено: Реєстр та Ієрархія — після змін у базі ' +
           '(не частіше, ніж раз на 3 хв), повна перебудова — щогодини.',
           'L-TEX Звіти', 8);
}

function disableAutoUpdate(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  if (silent !== true) {
    SpreadsheetApp.getActive().toast('Автооновлення вимкнено.', 'L-TEX Звіти', 5);
  }
}

/**
 * Спрацьовує на будь-яку зміну в таблиці (зокрема з API/бота).
 * Швидка перебудова: тільки Реєстр + Ієрархія — усі формульні звіти
 * (матриці, дашборд, зведена) підхоплюють оновлений Реєстр миттєво.
 */
function ltexOnChange(e) {
  var cache = CacheService.getScriptCache();
  if (cache.get('ltex_throttle')) return;   // не частіше, ніж раз на 3 хв
  cache.put('ltex_throttle', '1', 180);
  quickRebuild();
}

function ltexHourly() {
  rebuildAll();
}

function quickRebuild() {
  var ss = SpreadsheetApp.getActive();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var model = collectData(ss);
    if (!model.rows.length) return; // джерело порожнє/недоступне — не стираємо звіти
    buildRegistry(ss, model);
    buildTree(ss, model);
    ensurePivot(ss);
  } finally {
    lock.releaseLock();
  }
}
