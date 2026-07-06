// CDP: set visible range Sep01-10 and read box data
import CDP from 'chrome-remote-interface';

const FROM_UNIX = 1756684800; // Sep01 2025 00:00 UTC
const TO_UNIX   = 1757548800; // Sep10 2025 00:00 UTC

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
if (!t) { console.error('No TradingView target'); process.exit(1); }
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

// Set visible range
const setRange = await c.Runtime.evaluate({
  expression: `(function() {
    try {
      var keys = Object.keys(window).filter(k => k.toLowerCase().includes('trading') || k.toLowerCase().includes('chart'));
      if (window.TradingViewApi) {
        var chart = window.TradingViewApi.activeChart();
        chart.setVisibleRange({from: ${FROM_UNIX}, to: ${TO_UNIX}});
        return JSON.stringify({ok: true, api: 'TradingViewApi'});
      }
      // Try chartWidgetCollection
      if (window.chartWidgetCollection) {
        var cw = window.chartWidgetCollection;
        var w = cw.activeWidgetOrChartWidget && cw.activeWidgetOrChartWidget();
        if (w && w.chart && w.chart()) {
          w.chart().setVisibleRange({from: ${FROM_UNIX}, to: ${TO_UNIX}});
          return JSON.stringify({ok: true, api: 'chartWidgetCollection'});
        }
      }
      return JSON.stringify({error: 'no API', windowKeys: Object.keys(window).filter(k => /chart|trading/i.test(k)).slice(0,20).join(',')});
    } catch(e) {
      return JSON.stringify({error: e.message});
    }
  })()`,
  returnByValue: true,
});
console.log('setVisibleRange:', setRange.result?.value);

await new Promise(r => setTimeout(r, 2500));
await c.close();
