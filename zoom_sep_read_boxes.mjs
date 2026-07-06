import CDP from 'chrome-remote-interface';

const FROM_UNIX = 1756684800; // Sep01 2025 00:00 UTC  
const TO_UNIX   = 1757548800; // Sep10 2025 00:00 UTC

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
if (!t) { console.error('No TradingView target'); process.exit(1); }
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

// Set visible range (same as MCP setVisibleRange core implementation)
const setRange = await c.Runtime.evaluate({
  expression: `(function() {
    try {
      var chart = window.TradingViewApi._activeChartWidgetWV.value();
      var m = chart._chartWidget.model();
      var ts = m.timeScale();
      var bars = m.mainSeries().bars();
      var startIdx = bars.firstIndex();
      var endIdx = bars.lastIndex();
      var fromIdx = startIdx, toIdx = endIdx;
      for (var i = startIdx; i <= endIdx; i++) {
        var v = bars.valueAt(i);
        if (v && v[0] >= ${FROM_UNIX} && fromIdx === startIdx) fromIdx = i;
        if (v && v[0] <= ${TO_UNIX}) toIdx = i;
      }
      ts.zoomToBarsRange(fromIdx, toIdx);
      return JSON.stringify({ok: true, fromIdx: fromIdx, toIdx: toIdx, totalBars: endIdx - startIdx + 1});
    } catch(e) {
      return JSON.stringify({error: e.message, stack: e.stack && e.stack.substr(0,300)});
    }
  })()`,
  returnByValue: true,
});
console.log('setVisibleRange result:', setRange.result?.value);

await new Promise(r => setTimeout(r, 1500));
await c.close();
