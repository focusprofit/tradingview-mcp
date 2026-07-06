import CDP from 'chrome-remote-interface';

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

// Try to access Pine study source objects for box data
const result = await c.Runtime.evaluate({
  expression: `(function() {
    try {
      var chart = window.TradingViewApi._activeChartWidgetWV.value();
      var model = chart._chartWidget.model();
      
      // Find all series/studies
      var allStudies = model.studies ? model.studies() : null;
      if (!allStudies) return JSON.stringify({error: 'no model.studies()'});
      
      var result = [];
      for (var i = 0; i < allStudies.length; i++) {
        var s = allStudies[i];
        var meta = s.metaInfo ? s.metaInfo() : null;
        var shortName = meta ? (meta.shortDescription || meta.description || '') : '';
        if (shortName.includes('Trade Model') || shortName.includes('Focusprofit')) {
          // Try to get drawable objects
          var drawObjects = s.data ? s.data() : null;
          var boxes = [];
          if (drawObjects && drawObjects.boxes) {
            for (var b of drawObjects.boxes) {
              boxes.push({
                left: b.left, right: b.right, top: b.top, bottom: b.bottom,
                leftTime: b.leftTime, rightTime: b.rightTime
              });
            }
          }
          result.push({
            name: shortName,
            hasData: !!drawObjects,
            dataKeys: drawObjects ? Object.keys(drawObjects).join(',') : '',
            boxes: boxes.slice(0, 20)
          });
        }
      }
      return JSON.stringify({studies: result, totalStudies: allStudies.length});
    } catch(e) {
      return JSON.stringify({error: e.message, stack: e.stack && e.stack.substr(0,400)});
    }
  })()`,
  returnByValue: true,
});
console.log('Study boxes:', result.result?.value);
await c.close();
