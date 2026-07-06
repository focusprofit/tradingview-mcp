import CDP from 'chrome-remote-interface';

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
if (!t) { console.error('No TradingView target'); process.exit(1); }
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

// Read all Pine box drawings from chart directly
const result = await c.Runtime.evaluate({
  expression: `(function() {
    try {
      var chart = window.TradingViewApi._activeChartWidgetWV.value();
      var studies = chart.getAllStudies();
      var tmStudy = null;
      for (var s of studies) {
        if (s.name && s.name.includes('Trade Model')) { tmStudy = s; break; }
      }
      if (!tmStudy) return JSON.stringify({error: 'Trade Model study not found', studies: studies.map(s=>s.name)});
      
      // Try to get drawings from the study
      var shapes = chart.getShapeById ? chart.getShapeById(tmStudy.id) : null;
      
      // Try getAllShapes
      var allShapes = chart.getAllShapes ? chart.getAllShapes() : null;
      
      return JSON.stringify({
        studyId: tmStudy.id,
        studyName: tmStudy.name,
        shapesFromStudy: shapes ? JSON.stringify(shapes).substr(0,500) : 'null',
        allShapesCount: allShapes ? allShapes.length : 'null',
        allShapesSample: allShapes ? JSON.stringify(allShapes.slice(0,5)).substr(0,500) : 'null'
      });
    } catch(e) {
      return JSON.stringify({error: e.message, stack: e.stack && e.stack.substr(0,300)});
    }
  })()`,
  returnByValue: true,
});
console.log('Direct CDP read:', result.result?.value);
await c.close();
