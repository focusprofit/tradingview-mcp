import CDP from 'chrome-remote-interface';

// Sep02 2025 00:00 UTC = 1756771200
// Sep06 2025 00:00 UTC = 1757116800
const FROM_UNIX = 1756771200;
const TO_UNIX   = 1757116800;

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
if (!t) { console.error('No TradingView target'); process.exit(1); }
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

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
      // Also report some bar times to verify range
      var sampleBars = [];
      for (var i = Math.max(startIdx, fromIdx-2); i <= Math.min(endIdx, toIdx+2); i++) {
        var v = bars.valueAt(i);
        if (v) sampleBars.push({idx: i, t: v[0]});
        if (sampleBars.length >= 10) break;
      }
      return JSON.stringify({ok: true, fromIdx, toIdx, totalBars: endIdx-startIdx+1, sampleBars});
    } catch(e) {
      return JSON.stringify({error: e.message});
    }
  })()`,
  returnByValue: true,
});
console.log('zoom Sep02-06:', setRange.result?.value);

await new Promise(r => setTimeout(r, 1500));
await c.close();
