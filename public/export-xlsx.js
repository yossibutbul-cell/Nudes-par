/* Excel export of the whole par system.
   Pure: takes plain data (timestamps as Date objects) and an ExcelJS namespace, returns a
   Workbook. No DOM or Firebase here, so the same code can be checked outside the app. */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const METHODS = { email: 'email', whatsapp: 'whatsapp', sms: 'text message', phone: 'phone', portal: 'supplier portal' };
const OFFSETS = { 0: 'same day', 1: 'day before delivery', 2: 'two days before' };
const TAGS = { 'halal': 'halal', 'gluten-free': 'gluten free', 'dairy-free': 'dairy free', 'vegan': 'vegan',
  'ou-kosher-pareve': 'OU kosher (pareve)', 'ou-kosher-dairy': 'OU kosher (dairy)', 'kosher-pareve': 'kosher (pareve)', 'kosher-chalavi': 'kosher (chalavi)' };

const FONT = 'Arial';
const HEAD_FONT = { name: FONT, bold: true, size: 10, color: { argb: 'FFF2E9D8' } };     // cream
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF442917' } }; // nudes espresso
const BODY_FONT = { name: FONT, size: 10, color: { argb: 'FF000000' } };
const INPUT_FONT = { name: FONT, size: 10, color: { argb: 'FF0000FF' } };               // blue = typed-in numbers
const LINE = { bottom: { style: 'thin', color: { argb: 'FFDCCCBB' } } };
const MONEY = '$#,##0.00;($#,##0.00);"-"';
const MONEY4 = '$#,##0.0000;($#,##0.0000);"-"';
const QTY = '# ?/?';                       // shows 2.5 as "2 1/2"
const STAMP = 'yyyy-mm-dd h:mm AM/PM';
const DAY = 'yyyy-mm-dd';

const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
const arr = v => Array.isArray(v) ? v : [];

/* Data comes from Firestore, where any signed-in user can write counts and orders.
   ExcelJS turns objects such as {formula}, {hyperlink} or {richText} into live cells,
   so only formulas built here (tagged with a private symbol) may become formulas;
   every other value is forced to plain text, a number or a date. */
const OURS = Symbol('export formula');
const formula = expr => ({ formula: expr, [OURS]: true });
function cellValue(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v[OURS]) return { formula: v.formula };
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
const col = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };

/* Excel has no time zones: write each moment as the store's wall-clock time. */
function wallClock(d, timeZone) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).filter(x => x.type !== 'literal').map(x => [x.type, +x.value]));
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second));
}
const dayKey = k => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ''); return m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3])) : null; };

function addSheet(wb, name, columns, rows, { freezeCol = true, notes = {} } = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: freezeCol ? 1 : 0, ySplit: 1, zoomScale: 110 }] });
  const head = ws.addRow(columns.map(c => c.h));
  head.height = 30;
  head.eachCell(cell => { cell.font = HEAD_FONT; cell.fill = HEAD_FILL; cell.alignment = { vertical: 'middle', wrapText: true }; });
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
  rows.forEach(values => {
    const row = ws.addRow(values.map(cellValue));
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.font = c.input ? INPUT_FONT : BODY_FONT;
      cell.border = LINE;
      cell.alignment = { vertical: 'top', wrapText: true };
      if (c.fmt) cell.numFmt = c.fmt;
    });
  });
  if (rows.length) ws.autoFilter = `A1:${col(columns.length)}${rows.length + 1}`;
  Object.entries(notes).forEach(([ref, text]) => { ws.getCell(ref).note = text; });
  return ws;
}

export function buildWorkbook(ExcelJS, d) {
  const tz = d.timeZone || 'America/Los_Angeles';
  const at = v => wallClock(v, tz);
  const settings = d.settings || {};
  const cats = arr(settings.categories).filter(x => typeof x === 'string');
  const areas = arr(settings.areas).filter(x => typeof x === 'string');
  const sups = Object.fromEntries(arr(d.suppliers).map(s => [s.id, s]));
  const openCount = (d.counts || []).find(c => c.id === d.openCountId && c.status === 'open') || null;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'nudes par & ordering';
  wb.created = d.exportedAt || new Date();
  wb.calcProperties.fullCalcOnLoad = true;   // Excel/Numbers compute every formula on open

  // ── Items ─────────────────────────────────────────────────────────
  const order = Object.fromEntries(cats.map((c, i) => [c, i]));
  const items = [...(d.items || [])].sort((a, b) => ((order[a.group] ?? 99) - (order[b.group] ?? 99)) || String(a.name ?? '').localeCompare(String(b.name ?? '')));
  const n = items.length, last = n + 1;
  addSheet(wb, 'Items', [
    { h: 'Item', w: 30 }, { h: 'Category', w: 18 }, { h: 'Product line', w: 26 }, { h: 'Supplier', w: 20 },
    { h: 'Storage area', w: 15 }, { h: 'Supplier code', w: 13 }, { h: 'Count unit', w: 12 },
    { h: 'Units per case', w: 10, fmt: '0', input: true }, { h: 'Par (units)', w: 10, fmt: QTY, input: true },
    { h: 'Case price ($)', w: 12, fmt: MONEY, input: true }, { h: 'Price per unit ($)', w: 13, fmt: MONEY },
    { h: 'Unit weight (oz)', w: 11, fmt: '0.00', input: true }, { h: 'Price per oz ($)', w: 13, fmt: MONEY4 },
    { h: 'Dietary', w: 34 }, { h: `On hand (open count${openCount ? ', ' + openCount.date : ''})`, w: 14, fmt: QTY },
  ], items.map((it, i) => {
    const r = i + 2, e = openCount?.entries?.[it.id];
    return [
      it.name, it.group || 'uncategorized', it.category || null, sups[it.supplierId]?.name || '—', it.area || null,
      it.code || null, it.unit || null, num(it.unitsPerCase) || 1, num(it.par), num(it.casePrice),
      formula(`IF(OR(J${r}="",H${r}=0),"",J${r}/H${r})`),
      num(it.weightOz),
      formula(`IF(OR(K${r}="",L${r}="",L${r}=0),"",K${r}/L${r})`),
      arr(it.tags).map(t => TAGS[t] || String(t)).join(', ') || null,
      e && typeof e === 'object' ? num(e.on) : null,
    ];
  }), { notes: { I1: 'Fractions show as e.g. "2 1/2".', K1: 'Formula: case price ÷ units per case.', M1: 'Formula: price per unit ÷ unit weight (oz). Blank until a unit weight is entered.' } });

  // ── Suppliers ─────────────────────────────────────────────────────
  const supList = [...(d.suppliers || [])].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  addSheet(wb, 'Suppliers', [
    { h: 'Supplier', w: 24 }, { h: 'Contact', w: 16 }, { h: 'Order via', w: 15 }, { h: 'Send orders to', w: 30 },
    { h: 'Delivery days', w: 22 }, { h: 'Order cut-off', w: 12 }, { h: 'Cut-off is', w: 20 }, { h: 'Notes', w: 30 }, { h: 'Items', w: 8, fmt: '0' },
  ], supList.map((s, i) => [
    s.name, s.contact || null, METHODS[s.method] || s.method || null, s.to || null,
    arr(s.deliveryDays).filter(x => Number.isInteger(x) && x >= 0 && x < 7).map(x => DAYS[x]).join(' · ') || 'on request',
    s.cutoffTime || null, s.cutoffTime ? (OFFSETS[s.cutoffOffset ?? 1] || null) : null, s.notes || null,
    formula(`COUNTIF(Items!$D$2:$D$${last},A${i + 2})`),
  ]));

  // ── Categories / Storage areas ────────────────────────────────────
  for (const [title, head, values, c] of [['Categories', 'Category', cats, 'B'], ['Storage Areas', 'Storage area', areas, 'E']]) {
    addSheet(wb, title, [{ h: head, w: 26 }, { h: 'Items', w: 8, fmt: '0' }],
      values.map((v, i) => [v, formula(`COUNTIF(Items!$${c}$2:$${c}$${last},A${i + 2})`)]), { freezeCol: false });
  }

  // ── Team ──────────────────────────────────────────────────────────
  const team = [...(d.users || [])].sort((a, b) => ((a.role !== 'admin') - (b.role !== 'admin')) || String(a.id).localeCompare(String(b.id)));
  addSheet(wb, 'Team', [{ h: 'Email', w: 32 }, { h: 'Name', w: 22 }, { h: 'Role', w: 10 }, { h: 'Last seen', w: 20, fmt: STAMP }],
    team.map(u => [u.id, u.name || null, u.role || null, at(u.lastSeen)]));

  // ── Counts ────────────────────────────────────────────────────────
  const when = c => (c.startedAt instanceof Date ? c.startedAt : dayKey(c.date)) || new Date(0);
  const counts = [...(d.counts || [])].sort((a, b) => when(b) - when(a));
  addSheet(wb, 'Counts', [
    { h: 'Count date', w: 12, fmt: DAY }, { h: 'Status', w: 13 }, { h: 'Started by', w: 14 }, { h: 'Started at', w: 20, fmt: STAMP },
    { h: 'Finalized by', w: 14 }, { h: 'Finalized at', w: 20, fmt: STAMP }, { h: 'Items counted', w: 10, fmt: '0' },
    { h: 'Below par', w: 10, fmt: '0' }, { h: 'Out of stock', w: 10, fmt: '0' }, { h: 'Est. order cost ($)', w: 14, fmt: MONEY }, { h: 'Summary emailed to', w: 34 },
  ], counts.map(c => {
    const es = Object.values(c.entries || {}).filter(e => e && typeof e === 'object');
    const low = es.filter(e => num(e.on) > 0 && num(e.on) < (num(e.par) || 0)).length;
    const out = es.filter(e => num(e.on) === 0).length;
    return [dayKey(c.date), c.status || 'legacy (daily)', c.startedBy || null, at(c.startedAt), c.finalizedBy || null, at(c.finalizedAt),
      es.length, low, out, num(c.summary?.totalCost), arr(c.managerEmails).map(String).join(', ') || null];
  }));

  // ── Orders sent ───────────────────────────────────────────────────
  const orders = [...(d.orders || [])].sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
  addSheet(wb, 'Orders Sent', [
    { h: 'Count date', w: 12, fmt: DAY }, { h: 'Supplier', w: 22 }, { h: 'Sent by', w: 12 }, { h: 'Sent at', w: 20, fmt: STAMP },
    { h: 'Sent via', w: 12 }, { h: 'Sent to', w: 28 }, { h: 'Line items', w: 9, fmt: '0' }, { h: 'Cases', w: 8, fmt: '0' },
    { h: 'Est. cost ($)', w: 13, fmt: MONEY }, { h: 'Unpriced lines', w: 10, fmt: '0' }, { h: 'Order lines', w: 60 },
  ], orders.map(o => {
    const lines = arr(o.lines).filter(l => l && typeof l === 'object');
    return [dayKey(o.date), o.supplierName || null, o.sentBy || null, at(o.sentAt), METHODS[o.method] || o.method || null, o.to || null,
      lines.length, num(o.totalCases), num(o.totalCost), num(o.unpriced), lines.map(l => `${num(l.cases) ?? '?'} × ${cellValue(l.name) ?? ''}`).join('\n') || null];
  }));

  // ── Settings ──────────────────────────────────────────────────────
  const stamp = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' }).format(d.exportedAt || new Date());
  addSheet(wb, 'Settings', [{ h: 'Setting', w: 26 }, { h: 'Value', w: 60 }], [
    ['Store name', settings.storeName || null], ['Address', settings.address || null], ['City', settings.city || null],
    ['Order sign-off', settings.signoff || null], ['Order manager emails', arr(settings.managerEmails).map(String).join(', ') || null],
    ['Categories', cats.join(', ')], ['Storage areas', areas.join(', ')],
    ['Exported', `${stamp} (store time)${d.exportedBy ? ' by ' + d.exportedBy : ''}`],
  ], { freezeCol: false });

  return wb;
}
