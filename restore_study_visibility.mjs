import CDP from 'chrome-remote-interface';
const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();
const result = await c.Runtime.evaluate({
  expression: `(function() {
    try {
      var chart = window.TradingViewApi._activeChartWidgetWV.value();
      var studies = chart.getAllStudies();
      var tmStudy = studies.find(function(s) { return s.name && s.name.includes('Trade Model'); });
      if (!tmStudy) return JSON.stringify({error: 'not found'});
      chart.setEntityVisibility(tmStudy.id, true);
      return JSON.stringify({ok: true, studyId: tmStudy.id});
    } catch(e) { return JSON.stringify({error: e.message}); }
  })()`,
  returnByValue: true,
});
console.log('Restore visibility:', result.result?.value);
await c.close();
