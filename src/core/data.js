/**
 * Core data access logic.
 */
import { evaluate, evaluateAsync, KNOWN_PATHS, safeString } from '../connection.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

// Dump directory for full-payload JSON dumps (TM-261): <repo>/dumps.
// Keeping large dumps on disk instead of streaming them through the agent
// context is the point — debugging works against the file.
const __dirnameData = dirname(fileURLToPath(import.meta.url));
export const DUMP_DIR = join(dirname(dirname(__dirnameData)), 'dumps');

export function resolveDumpPath(requested, prefix, ext) {
  if (typeof requested === 'string' && requested && requested !== 'true') {
    return isAbsolute(requested) ? requested : join(DUMP_DIR, requested);
  }
  return join(DUMP_DIR, `${prefix}_${Date.now()}${ext}`);
}

export function writeDump(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 1));
  return path;
}

// Unix seconds → compact UTC string for dumps ("2026-01-27 20:00").
function isoMinute(unixSec) {
  return new Date(unixSec * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

// "YYYY-MM-DD", ISO datetime or unix-seconds string → unix seconds.
function parseTimeParam(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (/^\d+$/.test(String(value))) return Number(value);
  const ts = Math.floor(new Date(value).getTime() / 1000);
  if (isNaN(ts)) throw new Error(`Could not parse ${name}: "${value}". Use YYYY-MM-DD or unix seconds.`);
  return ts;
}

/**
 * Adaptive price rounding precision based on absolute value.
 * mintick is not available via current MCP API (quote_get / symbol_info
 * do not expose it); this heuristic covers the main instrument classes:
 *   - crypto, indices, metals (>=100): 2 decimal places
 *   - FX majors, major crosses (1..100): 5 decimal places
 *   - micro tokens (<1): 5 decimal places
 *
 * Known limitation: JPY pairs (~150) fall into the >=100 bucket and get
 * 2 decimal places instead of the needed 3-5. Exact fix via
 * chart.symbolExt().minmov is a separate follow-up task.
 */
function priceDecimals(value) {
    const abs = Math.abs(value);
    if (abs >= 100) return 2;
    return 5;
}

const MAX_OHLCV_BARS = 500;
const MAX_TRADES = 20;
const CHART_API = KNOWN_PATHS.chartApi;
const BARS_PATH = KNOWN_PATHS.mainSeriesBars;

function buildGraphicsJS(collectionName, mapKey, filter) {
  return `
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var tscale = model.timeScale();
      var sources = model.model().dataSources();
      var results = [];
      var filter = ${safeString(filter || '')};
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          if (filter && name.indexOf(filter) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          // Primitive x fields are positions in the study graphics timepoint
          // array (g._indexes), NOT bar indexes. Each entry holds the
          // timescale bar index, or a large-negative sentinel when the anchor
          // bar is outside the currently loaded history (such primitives are
          // not even rendered) — report those as unresolved (TM-261).
          var idxArr = g._indexes || null;
          var rtp = function(xi) {
            if (xi === undefined || xi === null || !idxArr) return null;
            var tp = idxArr[xi];
            if (tp === undefined || tp === null || tp <= -1000000) return null;
            var out = { bar: tp, time: null };
            try {
              var ut = tscale.indexToUserTime(tp);
              if (ut) out.time = Math.round(ut.getTime() / 1000);
            } catch (e) {}
            return out;
          };
          var pc = s._graphics._primitivesCollection;
          var items = [];
          try {
            var outer = pc.${collectionName};
            if (outer) {
              var inner = outer.get('${mapKey}');
              if (inner) {
                var coll = inner.get(false);
                if (coll && coll._primitivesDataById && coll._primitivesDataById.size > 0) {
                  coll._primitivesDataById.forEach(function(v, id) {
                    items.push({id: id, raw: v, tp0: rtp(v.x !== undefined ? v.x : v.x1), tp1: rtp(v.x2)});
                  });
                }
              }
            }
          } catch(e) {}
          if (items.length === 0 && '${collectionName}' === 'dwgtablecells') {
            try {
              var tcOuter = pc.dwgtablecells;
              if (tcOuter) {
                var tcColl = tcOuter.get('tableCells');
                if (tcColl && tcColl._primitivesDataById && tcColl._primitivesDataById.size > 0) {
                  tcColl._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            } catch(e) {}
          }
          if (items.length > 0) results.push({name: name, count: items.length, items: items});
        } catch(e) {}
      }
      return results;
    })()
  `;
}

export async function getOhlcv({ count, summary } = {}) {
  const limit = Math.min(count || 100, MAX_OHLCV_BARS);
  let data;
  try {
    data = await evaluate(`
      (function() {
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') return null;
        var result = [];
        var end = bars.lastIndex();
        var start = Math.max(bars.firstIndex(), end - ${limit} + 1);
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (v) result.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
        }
        return {bars: result, total_bars: bars.size(), source: 'direct_bars'};
      })()
    `);
  } catch { data = null; }

  if (!data || !data.bars || data.bars.length === 0) {
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }

  if (summary) {
    const bars = data.bars;
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const volumes = bars.map(b => b.volume);
    const first = bars[0];
    const last = bars[bars.length - 1];
    return {
      success: true, bar_count: bars.length,
      period: { from: first.time, to: last.time },
      open: first.open, close: last.close,
      high: Math.max(...highs), low: Math.min(...lows),
      range: Math.round((Math.max(...highs) - Math.min(...lows)) * 100) / 100,
      change: Math.round((last.close - first.open) * 100) / 100,
      change_pct: Math.round(((last.close - first.open) / first.open) * 10000) / 100 + '%',
      avg_volume: Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length),
      last_5_bars: bars.slice(-5),
    };
  }

  return { success: true, bar_count: data.bars.length, total_available: data.total_bars, source: data.source, bars: data.bars };
}

export async function getIndicator({ entity_id }) {
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var study = api.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };
      var result = { name: null, inputs: null, visible: null };
      try { result.visible = study.isVisible(); } catch(e) {}
      try { result.inputs = study.getInputValues(); } catch(e) { result.inputs_error = e.message; }
      return result;
    })()
  `);

  if (data?.error) throw new Error(data.error);

  let inputs = data?.inputs;
  if (Array.isArray(inputs)) {
    inputs = inputs.filter(inp => {
      if (inp.id === 'text' && typeof inp.value === 'string' && inp.value.length > 200) return false;
      if (typeof inp.value === 'string' && inp.value.length > 500) return false;
      return true;
    });
  }
  return { success: true, entity_id, visible: data?.visible, inputs };
}

export async function getStrategyResults() {
  const results = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = null;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (s.metaInfo && s.metaInfo().is_price_study === false && (s.reportData || s.performance)) { strat = s; break; }
        }
        if (!strat) return {metrics: {}, source: 'internal_api', error: 'No strategy found on chart. Add a strategy indicator first.'};
        var metrics = {};
        if (strat.reportData) {
          var rd = typeof strat.reportData === 'function' ? strat.reportData() : strat.reportData;
          if (rd && typeof rd === 'object') {
            if (typeof rd.value === 'function') rd = rd.value();
            if (rd) { var keys = Object.keys(rd); for (var k = 0; k < keys.length; k++) { var val = rd[keys[k]]; if (val !== null && val !== undefined && typeof val !== 'function') metrics[keys[k]] = val; } }
          }
        }
        if (Object.keys(metrics).length === 0 && strat.performance) {
          var perf = strat.performance();
          if (perf && typeof perf.value === 'function') perf = perf.value();
          if (perf && typeof perf === 'object') { var pkeys = Object.keys(perf); for (var p = 0; p < pkeys.length; p++) { var pval = perf[pkeys[p]]; if (pval !== null && pval !== undefined && typeof pval !== 'function') metrics[pkeys[p]] = pval; } }
        }
        return {metrics: metrics, source: 'internal_api'};
      } catch(e) { return {metrics: {}, source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, metric_count: Object.keys(results?.metrics || {}).length, source: results?.source, metrics: results?.metrics || {}, error: results?.error };
}

export async function getTrades({ max_trades } = {}) {
  const limit = Math.min(max_trades || 20, MAX_TRADES);
  const trades = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = null;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (s.metaInfo && s.metaInfo().is_price_study === false && (s.ordersData || s.reportData)) { strat = s; break; }
        }
        if (!strat) return {trades: [], source: 'internal_api', error: 'No strategy found on chart.'};
        var orders = null;
        if (strat.ordersData) { orders = typeof strat.ordersData === 'function' ? strat.ordersData() : strat.ordersData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        if (!orders || !Array.isArray(orders)) {
          if (strat._orders) orders = strat._orders;
          else if (strat.tradesData) { orders = typeof strat.tradesData === 'function' ? strat.tradesData() : strat.tradesData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        }
        if (!orders || !Array.isArray(orders)) return {trades: [], source: 'internal_api', error: 'ordersData() returned non-array.'};
        var result = [];
        for (var t = 0; t < Math.min(orders.length, ${limit}); t++) {
          var o = orders[t];
          if (typeof o === 'object' && o !== null) {
            var trade = {};
            var okeys = Object.keys(o);
            for (var k = 0; k < okeys.length; k++) { var v = o[okeys[k]]; if (v !== null && v !== undefined && typeof v !== 'function' && typeof v !== 'object') trade[okeys[k]] = v; }
            result.push(trade);
          }
        }
        return {trades: result, source: 'internal_api'};
      } catch(e) { return {trades: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, trade_count: trades?.trades?.length || 0, source: trades?.source, trades: trades?.trades || [], error: trades?.error };
}

export async function getEquity() {
  const equity = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = null;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (s.metaInfo && s.metaInfo().is_price_study === false && (s.reportData || s.performance)) { strat = s; break; }
        }
        if (!strat) return {data: [], source: 'internal_api', error: 'No strategy found on chart.'};
        var data = [];
        if (strat.equityData) {
          var eq = typeof strat.equityData === 'function' ? strat.equityData() : strat.equityData;
          if (eq && typeof eq.value === 'function') eq = eq.value();
          if (Array.isArray(eq)) data = eq;
        }
        if (data.length === 0 && strat.bars) {
          var bars = typeof strat.bars === 'function' ? strat.bars() : strat.bars;
          if (bars && typeof bars.lastIndex === 'function') {
            var end = bars.lastIndex(); var start = bars.firstIndex();
            for (var i = start; i <= end; i++) { var v = bars.valueAt(i); if (v) data.push({time: v[0], equity: v[1], drawdown: v[2] || null}); }
          }
        }
        if (data.length === 0) {
          var perfData = {};
          if (strat.performance) {
            var perf = strat.performance();
            if (perf && typeof perf.value === 'function') perf = perf.value();
            if (perf && typeof perf === 'object') { var pkeys = Object.keys(perf); for (var p = 0; p < pkeys.length; p++) { if (/equity|drawdown|profit|net/i.test(pkeys[p])) perfData[pkeys[p]] = perf[pkeys[p]]; } }
          }
          if (Object.keys(perfData).length > 0) return {data: [], equity_summary: perfData, source: 'internal_api', note: 'Full equity curve not available via API; equity summary metrics returned instead.'};
        }
        return {data: data, source: 'internal_api'};
      } catch(e) { return {data: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, data_points: equity?.data?.length || 0, source: equity?.source, data: equity?.data || [], equity_summary: equity?.equity_summary, note: equity?.note, error: equity?.error };
}

export async function getQuote({ symbol } = {}) {
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var sym = ${safeString(symbol || '')};
      if (!sym) { try { sym = api.symbol(); } catch(e) {} }
      if (!sym) { try { sym = api.symbolExt().symbol; } catch(e) {} }
      var ext = {};
      try { ext = api.symbolExt() || {}; } catch(e) {}
      var bars = ${BARS_PATH};
      var quote = { symbol: sym };
      if (bars && typeof bars.lastIndex === 'function') {
        var last = bars.valueAt(bars.lastIndex());
        if (last) { quote.time = last[0]; quote.open = last[1]; quote.high = last[2]; quote.low = last[3]; quote.close = last[4]; quote.last = last[4]; quote.volume = last[5] || 0; }
      }
      try {
        var bidEl = document.querySelector('[class*="bid"] [class*="price"], [class*="dom-"] [class*="bid"]');
        var askEl = document.querySelector('[class*="ask"] [class*="price"], [class*="dom-"] [class*="ask"]');
        if (bidEl) quote.bid = parseFloat(bidEl.textContent.replace(/[^0-9.\\-]/g, ''));
        if (askEl) quote.ask = parseFloat(askEl.textContent.replace(/[^0-9.\\-]/g, ''));
      } catch(e) {}
      try {
        var hdr = document.querySelector('[class*="headerRow"] [class*="last-"]');
        if (hdr) { var hdrPrice = parseFloat(hdr.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(hdrPrice)) quote.header_price = hdrPrice; }
      } catch(e) {}
      if (ext.description) quote.description = ext.description;
      if (ext.exchange) quote.exchange = ext.exchange;
      if (ext.type) quote.type = ext.type;
      return quote;
    })()
  `);
  if (!data || (!data.last && !data.close)) throw new Error('Could not retrieve quote. The chart may still be loading.');
  return { success: true, ...data };
}

export async function getDepth() {
  const data = await evaluate(`
    (function() {
      var domPanel = document.querySelector('[class*="depth"]')
        || document.querySelector('[class*="orderBook"]')
        || document.querySelector('[class*="dom-"]')
        || document.querySelector('[class*="DOM"]')
        || document.querySelector('[data-name="dom"]');
      if (!domPanel) return { found: false, error: 'DOM / Depth of Market panel not found.' };
      var bids = [], asks = [];
      var rows = domPanel.querySelectorAll('[class*="row"], tr');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var priceEl = row.querySelector('[class*="price"]');
        var sizeEl = row.querySelector('[class*="size"], [class*="volume"], [class*="qty"]');
        if (!priceEl) continue;
        var price = parseFloat(priceEl.textContent.replace(/[^0-9.\\-]/g, ''));
        var size = sizeEl ? parseFloat(sizeEl.textContent.replace(/[^0-9.\\-]/g, '')) : 0;
        if (isNaN(price)) continue;
        var rowClass = row.className || '';
        var rowHTML = row.innerHTML || '';
        if (/bid|buy/i.test(rowClass) || /bid|buy/i.test(rowHTML)) bids.push({ price, size });
        else if (/ask|sell/i.test(rowClass) || /ask|sell/i.test(rowHTML)) asks.push({ price, size });
        else if (i < rows.length / 2) asks.push({ price, size });
        else bids.push({ price, size });
      }
      if (bids.length === 0 && asks.length === 0) {
        var cells = domPanel.querySelectorAll('[class*="cell"], td');
        var prices = [];
        cells.forEach(function(c) { var val = parseFloat(c.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(val) && val > 0) prices.push(val); });
        if (prices.length > 0) return { found: true, raw_values: prices.slice(0, 50), bids: [], asks: [], note: 'Could not classify bid/ask levels.' };
      }
      bids.sort(function(a, b) { return b.price - a.price; });
      asks.sort(function(a, b) { return a.price - b.price; });
      var spread = null;
      if (asks.length > 0 && bids.length > 0) spread = +(asks[0].price - bids[0].price).toFixed(6);
      return { found: true, bids: bids, asks: asks, spread: spread };
    })()
  `);

  if (!data || !data.found) throw new Error(data?.error || 'DOM panel not found.');
  return { success: true, bid_levels: data.bids?.length || 0, ask_levels: data.asks?.length || 0, spread: data.spread, bids: data.bids || [], asks: data.asks || [], raw_values: data.raw_values, note: data.note };
}

export async function getStudyValues() {
  const data = await evaluate(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          var values = {};
          try {
            var dwv = s.dataWindowView();
            if (dwv) {
              var items = dwv.items();
              if (items) {
                for (var i = 0; i < items.length; i++) {
                  var item = items[i];
                  if (item._value && item._value !== '∅' && item._title) values[item._title] = item._value;
                }
              }
            }
          } catch(e) {}
          if (Object.keys(values).length > 0) results.push({ name: name, values: values });
        } catch(e) {}
      }
      return results;
    })()
  `);
  return { success: true, study_count: data?.length || 0, studies: data || [] };
}

export async function getPineLines({ study_filter, verbose, from, to, dump_to_file } = {}) {
  const filter = study_filter || '';
  const fromTs = parseTimeParam(from, 'from');
  const toTs = parseTimeParam(to, 'to');
  const raw = await evaluate(buildGraphicsJS('dwglines', 'lines', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const wantItems = verbose || dump_to_file;
  const studies = raw.map(s => {
    const hLevels = [];
    const seen = {};
    const allLines = [];
    let excludedUnresolved = 0;
    const items = s.items.slice().sort((a, b) => ((a.raw.x1 ?? a.raw.x ?? 0) - (b.raw.x1 ?? b.raw.x ?? 0)));
    for (const item of items) {
      const v = item.raw;
      const t1 = item.tp0 ? item.tp0.time : null;
      const t2 = item.tp1 ? item.tp1.time : null;
      if (fromTs != null || toTs != null) {
        const anchor = t2 != null ? t2 : t1; // line end (or start) inside the window
        if (anchor == null) { excludedUnresolved++; continue; }
        if (fromTs != null && anchor < fromTs) continue;
        if (toTs != null && (t1 != null ? t1 : anchor) > toTs) continue;
      }
      const y1 = v.y1 != null ? Number(v.y1.toFixed(priceDecimals(v.y1))) : null;
      const y2 = v.y2 != null ? Number(v.y2.toFixed(priceDecimals(v.y2))) : null;
      if (wantItems) {
        const rec = { id: item.id, y1, y2, time1: t1 != null ? isoMinute(t1) : null, time2: t2 != null ? isoMinute(t2) : null, x1: v.x1, x2: v.x2, horizontal: v.y1 === v.y2, style: v.st, width: v.w, color: v.ci };
        if (!item.tp0 && !item.tp1) rec.unresolved = true;
        allLines.push(rec);
      }
      if (y1 != null && v.y1 === v.y2 && !seen[y1]) { hLevels.push(y1); seen[y1] = true; }
    }
    hLevels.sort((a, b) => b - a);
    const result = { name: s.name, total_lines: s.count, horizontal_levels: hLevels };
    if (excludedUnresolved) result.excluded_unresolved = excludedUnresolved;
    if (wantItems) result.all_lines = allLines;
    return result;
  });

  if (dump_to_file) {
    const path = resolveDumpPath(dump_to_file, 'pine_lines', '.json');
    writeDump(path, { generated_at: new Date().toISOString(), study_filter: filter || null, from, to, studies });
    return { success: true, study_count: studies.length, dumped_to: path, studies: studies.map(s => ({ name: s.name, total_lines: s.total_lines, written: s.all_lines.length })) };
  }
  return { success: true, study_count: studies.length, studies };
}

export async function getPineLabels({ study_filter, max_labels, verbose, from, to, text_filter, dump_to_file } = {}) {
  const filter = study_filter || '';
  const fromTs = parseTimeParam(from, 'from');
  const toTs = parseTimeParam(to, 'to');
  const textNeedle = text_filter ? String(text_filter).toLowerCase() : null;
  const raw = await evaluate(buildGraphicsJS('dwglabels', 'labels', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const limit = max_labels || 50;
  const studies = raw.map(s => {
    let excludedUnresolved = 0;
    let labels = s.items.map(item => {
      const v = item.raw;
      const text = v.t || '';
      const price = v.y != null
        ? Number(v.y.toFixed(priceDecimals(v.y)))
        : null;
      const tp = item.tp0;
      const base = { text, price, time: tp && tp.time != null ? isoMinute(tp.time) : null };
      if (!tp) base.unresolved = true;
      if (verbose) Object.assign(base, { id: item.id, time_unix: tp ? tp.time : null, bar: tp ? tp.bar : null, x: v.x, yloc: v.yl, size: v.sz, textColor: v.tci, color: v.ci });
      base._x = v.x; // chronological sort key (timepoint order), stripped below
      base._t = tp ? tp.time : null;
      return base;
    }).filter(l => l.text || l.price != null);

    // x is the position in the study's timepoint array → chronological order.
    labels.sort((a, b) => (a._x ?? 0) - (b._x ?? 0));

    if (textNeedle) labels = labels.filter(l => (l.text || '').toLowerCase().includes(textNeedle));
    if (fromTs != null || toTs != null) {
      labels = labels.filter(l => {
        if (l._t == null) { excludedUnresolved++; return false; }
        if (fromTs != null && l._t < fromTs) return false;
        if (toTs != null && l._t > toTs) return false;
        return true;
      });
    }
    const matched = labels.length;
    if (!dump_to_file && labels.length > limit) labels = labels.slice(-limit);
    for (const l of labels) { delete l._x; delete l._t; }

    const out = { name: s.name, total_labels: s.count, matched, showing: labels.length, labels };
    if (excludedUnresolved) out.excluded_unresolved = excludedUnresolved;
    return out;
  });

  if (dump_to_file) {
    const path = resolveDumpPath(dump_to_file, 'pine_labels', '.json');
    writeDump(path, { generated_at: new Date().toISOString(), study_filter: filter || null, from, to, text_filter, studies });
    return {
      success: true,
      study_count: studies.length,
      dumped_to: path,
      studies: studies.map(s => ({ name: s.name, total_labels: s.total_labels, matched: s.matched, excluded_unresolved: s.excluded_unresolved })),
    };
  }
  return { success: true, study_count: studies.length, studies };
}

export async function getPineTables({ study_filter } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgtablecells', 'tableCells', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const tables = {};
    for (const item of s.items) {
      const v = item.raw;
      const tid = v.tid || 0;
      if (!tables[tid]) tables[tid] = {};
      if (!tables[tid][v.row]) tables[tid][v.row] = {};
      tables[tid][v.row][v.col] = v.t || '';
    }
    const tableList = Object.entries(tables).map(([tid, rows]) => {
      const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
      const formatted = rowNums.map(rn => {
        const cols = rows[rn];
        const colNums = Object.keys(cols).map(Number).sort((a, b) => a - b);
        return colNums.map(cn => cols[cn]).filter(Boolean).join(' | ');
      }).filter(Boolean);
      return { rows: formatted };
    });
    return { name: s.name, tables: tableList };
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineBoxes({ study_filter, verbose, from, to, dump_to_file } = {}) {
  const filter = study_filter || '';
  const fromTs = parseTimeParam(from, 'from');
  const toTs = parseTimeParam(to, 'to');
  const raw = await evaluate(buildGraphicsJS('dwgboxes', 'boxes', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const wantItems = verbose || dump_to_file;
  const studies = raw.map(s => {
    const zones = [];
    const seen = {};
    const allBoxes = [];
    let excludedUnresolved = 0;
    const items = s.items.slice().sort((a, b) => ((a.raw.x1 ?? 0) - (b.raw.x1 ?? 0)));
    for (const item of items) {
      const v = item.raw;
      const t1 = item.tp0 ? item.tp0.time : null;
      const t2 = item.tp1 ? item.tp1.time : null;
      if (fromTs != null || toTs != null) {
        const anchor = t2 != null ? t2 : t1;
        if (anchor == null) { excludedUnresolved++; continue; }
        if (fromTs != null && anchor < fromTs) continue;
        if (toTs != null && (t1 != null ? t1 : anchor) > toTs) continue;
      }
      const hi = v.y1 != null && v.y2 != null ? Math.max(v.y1, v.y2) : null;
      const lo = v.y1 != null && v.y2 != null ? Math.min(v.y1, v.y2) : null;
      const high = hi != null ? Number(hi.toFixed(priceDecimals(hi))) : null;
      const low  = lo != null ? Number(lo.toFixed(priceDecimals(lo))) : null;
      if (wantItems) {
        const rec = { id: item.id, high, low, time1: t1 != null ? isoMinute(t1) : null, time2: t2 != null ? isoMinute(t2) : null, x1: v.x1, x2: v.x2, borderColor: v.c, bgColor: v.bc };
        if (!item.tp0 && !item.tp1) rec.unresolved = true;
        allBoxes.push(rec);
      }
      if (high != null && low != null) { const key = high + ':' + low; if (!seen[key]) { zones.push({ high, low }); seen[key] = true; } }
    }
    zones.sort((a, b) => b.high - a.high);
    const result = { name: s.name, total_boxes: s.count, zones };
    if (excludedUnresolved) result.excluded_unresolved = excludedUnresolved;
    if (wantItems) result.all_boxes = allBoxes;
    return result;
  });

  if (dump_to_file) {
    const path = resolveDumpPath(dump_to_file, 'pine_boxes', '.json');
    writeDump(path, { generated_at: new Date().toISOString(), study_filter: filter || null, from, to, studies });
    return { success: true, study_count: studies.length, dumped_to: path, studies: studies.map(s => ({ name: s.name, total_boxes: s.total_boxes, written: s.all_boxes.length })) };
  }
  return { success: true, study_count: studies.length, studies };
}
