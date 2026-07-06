import CDP from 'chrome-remote-interface';

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
if (!t) { console.error('No TV target'); process.exit(1); }
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

const ev = async (expr) => {
  const r = await c.Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('CDP: ' + (d.exception && d.exception.description || d.text));
  }
  return r.result.value;
};

// Find "Update on chart" button and click it
const clickResult = await ev(`(function() {
  var btns = Array.from(document.querySelectorAll('button'));
  
  // Look for "Update on chart" button
  var updateBtn = btns.find(function(b) {
    var txt = b.textContent.trim();
    return (txt === 'Update on chart' || txt.includes('Update on chart') || b.title === 'Update on chart') && b.offsetParent !== null && !b.disabled;
  });
  
  if (updateBtn) {
    updateBtn.click();
    return 'clicked_update_on_chart:' + updateBtn.textContent.trim();
  }
  
  // Also try "Add to chart"
  var addBtn = btns.find(function(b) {
    var txt = b.textContent.trim();
    return (txt === 'Add to chart' || b.title === 'Add to chart') && b.offsetParent !== null && !b.disabled;
  });
  if (addBtn) {
    addBtn.click();
    return 'clicked_add_to_chart:' + addBtn.textContent.trim();
  }
  
  return 'not_found';
})()`);

console.log('Click result:', clickResult);

if (clickResult && clickResult.startsWith('clicked')) {
  console.log('Waiting 4s for study reload...');
  await new Promise(r => setTimeout(r, 4000));
  console.log('Done waiting');
}

await c.close();
