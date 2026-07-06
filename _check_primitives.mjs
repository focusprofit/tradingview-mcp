import CDP from 'chrome-remote-interface';

const CDP_PORT = 9222;

async function main() {
  const resp = await fetch(`http://localhost:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const target = targets.find(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url));
  if (!target) throw new Error('No chart target');
  
  const client = await CDP({ host: 'localhost', port: CDP_PORT, target: target.id });
  await client.Runtime.enable();

  const ev = async (expr) => {
    const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('CDP eval error: ' + JSON.stringify(r.exceptionDetails).substring(0, 200));
    return r.result.value;
  };

  // Get all primitives from the study
  const primitives = await ev(`
    (function() {
      try {
        var api = window.TradingViewApi;
        if (!api) return {error: 'no API'};
        var chart = api._activeChartWidgetWV ? api._activeChartWidgetWV.value() : null;
        if (!chart) return {error: 'no chart'};
        var model = chart._chartWidget ? chart._chartWidget.model() : null;
        if (!model) return {error: 'no model'};
        
        // Find data sources (studies)
        var sources = model.model ? model.model().dataSources() : model.dataSources ? model.dataSources() : [];
        var results = [];
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          var name = s.metaInfo ? (typeof s.metaInfo === 'function' ? s.metaInfo().shortTitle : s.metaInfo.shortTitle) : 'unknown';
          var hasBoxes = s._primitivesDataById ? true : false;
          var boxCount = hasBoxes ? Object.keys(s._primitivesDataById).length : 0;
          results.push({ index: i, name: name, hasBoxes: hasBoxes, boxCount: boxCount });
        }
        return { count: sources.length, sources: results };
      } catch(e) {
        return { error: e.message };
      }
    })()
  `);
  console.log('Primitives check:', JSON.stringify(primitives, null, 2));

  await client.close();
}

main().catch(e => { console.error('FAILED:', e.message); });
