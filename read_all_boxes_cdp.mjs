import CDP from 'chrome-remote-interface';

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

const result = await c.Runtime.evaluate({
  expression: `(function() {
    try {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var tscale = model.timeScale();
      var sources = model.model().dataSources();
      
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        var meta = s.metaInfo();
        var name = meta.description || meta.shortDescription || '';
        if (!name.includes('Trade Model')) continue;
        
        var g = s._graphics;
        if (!g || !g._primitivesCollection) { return JSON.stringify({error: 'no _primitivesCollection'}); }
        var idxArr = g._indexes || null;
        
        var rtp = function(xi) {
          if (xi === undefined || xi === null || !idxArr) return null;
          var tp = idxArr[xi];
          if (tp === undefined || tp === null || tp <= -1000000) return {sentinel: true, raw: tp};
          var out = { bar: tp };
          try {
            var ut = tscale.indexToUserTime(tp);
            if (ut) out.time = Math.round(ut.getTime() / 1000);
          } catch(e) {}
          return out;
        };
        
        var pc = g._primitivesCollection;
        var outer = pc.dwgboxes;
        if (!outer) return JSON.stringify({error: 'no dwgboxes', pcKeys: Object.keys(pc).join(',')});
        
        var inner = outer.get('boxes');
        if (!inner) return JSON.stringify({error: 'no boxes key in dwgboxes'});
        
        // Try both get(false) and get(true)
        var coll_false = inner.get(false);
        var coll_true = inner.get(true);
        
        var extractBoxes = function(coll, label) {
          if (!coll || !coll._primitivesDataById) return {label: label, size: 0, error: 'no _primitivesDataById'};
          var boxes = [];
          coll._primitivesDataById.forEach(function(v, id) {
            var tp0 = rtp(v.x1);
            var tp1 = rtp(v.x2);
            boxes.push({
              id: id,
              y1: v.y1 ? parseFloat(v.y1.toFixed(5)) : null,
              y2: v.y2 ? parseFloat(v.y2.toFixed(5)) : null,
              x1: v.x1, x2: v.x2,
              tp0_bar: tp0 ? tp0.bar : null,
              tp0_time: tp0 && !tp0.sentinel ? tp0.time : (tp0 && tp0.sentinel ? 'SENTINEL' : null),
              tp1_bar: tp1 ? tp1.bar : null,
              tp1_time: tp1 && !tp1.sentinel ? tp1.time : (tp1 && tp1.sentinel ? 'SENTINEL' : null),
              color: v.c, bgColor: v.bc
            });
          });
          boxes.sort((a,b) => (a.x1||0) - (b.x1||0));
          return {label: label, size: coll._primitivesDataById.size, boxes: boxes};
        };
        
        return JSON.stringify({
          studyName: name,
          idxArrLen: idxArr ? idxArr.length : 0,
          coll_false: extractBoxes(coll_false, 'get(false)'),
          coll_true: extractBoxes(coll_true, 'get(true)')
        });
      }
      return JSON.stringify({error: 'Trade Model not found'});
    } catch(e) {
      return JSON.stringify({error: e.message, stack: e.stack && e.stack.substr(0,400)});
    }
  })()`,
  returnByValue: true,
});

const data = JSON.parse(result.result?.value || '{}');
console.log(JSON.stringify(data, null, 2));
await c.close();
