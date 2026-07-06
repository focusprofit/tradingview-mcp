import CDP from 'chrome-remote-interface';

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

// Check user drawings on the chart
const userDrawings = await c.Runtime.evaluate({
  expression: `(function() {
    try {
      var chart = window.TradingViewApi._activeChartWidgetWV.value();
      var shapes = chart.getAllShapes();
      return JSON.stringify({
        count: shapes.length,
        shapes: shapes.map(function(s) {
          return {
            name: s.name,
            id: s.id,
            points: s.getPoints ? s.getPoints() : null
          };
        })
      });
    } catch(e) {
      return JSON.stringify({error: e.message});
    }
  })()`,
  returnByValue: true,
});
console.log('User drawings:', userDrawings.result?.value);

// Now hide the Trade Model study
const hideResult = await c.Runtime.evaluate({
  expression: `(function() {
    try {
      var chart = window.TradingViewApi._activeChartWidgetWV.value();
      var studies = chart.getAllStudies();
      var tmStudy = studies.find(function(s) { return s.name && s.name.includes('Trade Model'); });
      if (!tmStudy) return JSON.stringify({error: 'Trade Model not found', allStudies: studies.map(s=>s.name)});
      chart.setEntityVisibility(tmStudy.id, false);
      return JSON.stringify({ok: true, studyId: tmStudy.id, name: tmStudy.name});
    } catch(e) {
      return JSON.stringify({error: e.message});
    }
  })()`,
  returnByValue: true,
});
console.log('Hide study:', hideResult.result?.value);

await new Promise(r => setTimeout(r, 1500));
await c.close();
