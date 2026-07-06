import CDP from 'chrome-remote-interface';

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
if (!t) { console.error('No TradingView target'); process.exit(1); }
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

const ev = async (expr) => {
  const r = await c.Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('CDP eval: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

// Step 1: Find the Trade Model study entity ID
const studyInfo = await ev(`JSON.stringify((function() {
  try {
    var chart = window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV && window.TradingViewApi._activeChartWidgetWV.value();
    if (!chart) return {err: 'no chart widget'};
    var studies = chart.getAllStudies ? chart.getAllStudies() : [];
    return {count: studies.length, studies: studies.map(s => ({id: s.id, name: s.name}))};
  } catch(e) { return {err: e.message}; }
})()`);
console.log('Studies:', studyInfo);

// Step 2: Find and click "Add to chart" button in Pine Editor (try all iframes too)
const clickResult = await ev(`JSON.stringify((function() {
  function findAndClick(doc) {
    var buttons = Array.from(doc.querySelectorAll('button'));
    
    // Check by text content
    var btn = buttons.find(b => b.textContent.trim() === 'Add to chart' && !b.disabled);
    if (!btn) btn = buttons.find(b => b.textContent.includes('Add to chart') && b.offsetParent !== null && !b.disabled);
    // Check by data attributes  
    if (!btn) btn = doc.querySelector('[data-name="add-to-chart"]:not([disabled])');
    
    if (btn) {
      btn.click();
      return {clicked: true, text: btn.textContent.trim()};
    }
    return null;
  }
  
  // Try main document
  var r = findAndClick(document);
  if (r) return r;
  
  // Try iframes
  for (var frame of document.querySelectorAll('iframe')) {
    try {
      var r2 = findAndClick(frame.contentDocument);
      if (r2) return r2;
    } catch(e) {}
  }
  
  // No button: list visible buttons in Pine editor area for debug
  var allBtns = Array.from(document.querySelectorAll('button'))
    .filter(b => b.offsetParent !== null)
    .map(b => ({text: b.textContent.trim().slice(0,40), class: b.className.slice(0,50)}))
    .filter(b => b.text.length > 0)
    .slice(0, 20);
  return {clicked: false, visible_buttons: allBtns};
})()`);
console.log('Click result:', clickResult);

await new Promise(r => setTimeout(r, 500));
await c.close();
