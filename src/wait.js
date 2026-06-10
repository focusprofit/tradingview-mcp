import { evaluate, safeString } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 250;

// TM-261 (ex-TM-260 §2): model-based chart-ready probe instead of the old
// DOM heuristic (CSS-class spinner + querySelectorAll('[class*="bar"]')),
// which produced false negatives (chart_ready:false on a healthy chart) and
// could not see study recalculation at all (false study_count:0).
//
// Ready means: no blocking warning dialog, the main series has bars, the
// series tip is stable across two consecutive polls, the symbol/timeframe
// match the expectation, and (optionally) the expected study exposes
// graphics primitives again.
function probeJS(expectedSymbol, expectedTf, expectStudy) {
  return `
    (function() {
      var out = { ok: false };
      try {
        var dlg = document.querySelector('[data-name="warning-dialog"]');
        out.dialog = !!(dlg && dlg.offsetParent !== null);

        var chartApi = window.TradingViewApi._activeChartWidgetWV.value();
        out.symbol = String(chartApi.symbol() || '');
        out.resolution = String(chartApi.resolution() || '');

        var bars = chartApi._chartWidget.model().mainSeries().bars();
        var fi = bars.firstIndex(), li = bars.lastIndex();
        out.barCount = (fi != null && li != null && li >= fi) ? (li - fi + 1) : 0;
        var lastVal = (li != null) ? bars.valueAt(li) : null;
        out.lastBarTime = lastVal ? lastVal[0] : null;

        var expSym = ${safeString(expectedSymbol || '')};
        var expTf = ${safeString(expectedTf || '')};
        var expStudy = ${safeString(expectStudy || '')};
        out.symbolMatch = !expSym || out.symbol.toUpperCase().indexOf(expSym.toUpperCase()) !== -1;
        out.tfMatch = !expTf || out.resolution === String(expTf);

        out.studyMatch = true;
        if (expStudy) {
          out.studyMatch = false;
          var sources = chartApi._chartWidget.model().model().dataSources();
          for (var si = 0; si < sources.length; si++) {
            var s = sources[si];
            if (!s.metaInfo) continue;
            try {
              var meta = s.metaInfo();
              var name = meta.description || meta.shortDescription || '';
              if (name && name.indexOf(expStudy) !== -1 && s._graphics && s._graphics._primitivesCollection) {
                out.studyMatch = true;
                break;
              }
            } catch (e2) {}
          }
        }

        out.ok = !out.dialog && out.barCount > 0 && out.symbolMatch && out.tfMatch && out.studyMatch;
      } catch (e) { out.err = String(e); }
      return out;
    })()
  `;
}

export async function waitChartReadyDetailed({ expected_symbol, expected_tf, expect_study, timeout_ms = DEFAULT_TIMEOUT } = {}) {
  const start = Date.now();
  let prev = null;
  let probe = null;
  let polls = 0;

  while (Date.now() - start < timeout_ms) {
    probe = await evaluate(probeJS(expected_symbol, expected_tf, expect_study)).catch(() => null);
    polls++;
    if (probe && probe.ok && prev && prev.ok
        && probe.barCount === prev.barCount
        && probe.lastBarTime === prev.lastBarTime) {
      return { ready: true, polls, waited_ms: Date.now() - start, ...probe };
    }
    prev = probe;
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  return { ready: false, polls, waited_ms: Date.now() - start, ...(probe || {}) };
}

// Back-compat boolean wrapper — callers (setSymbol/setTimeframe/batch) treat
// the result as truthy "chart_ready".
export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT) {
  const r = await waitChartReadyDetailed({ expected_symbol: expectedSymbol, expected_tf: expectedTf, timeout_ms: timeout });
  return r.ready;
}
