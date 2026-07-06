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
    throw new Error('CDP eval error: ' + (d.exception && d.exception.description || d.text));
  }
  return r.result.value;
};

// Find "Add to chart" button - simple scan
const clickResult = await ev(`(function() {
  var btns = Array.from(document.querySelectorAll('button'));
  var addBtn = btns.find(function(b) {
    return (b.textContent.trim() === 'Add to chart' || b.title === 'Add to chart') && !b.disabled && b.offsetParent !== null;
  });
  if (addBtn) {
    addBtn.click();
    return 'clicked:' + addBtn.textContent.trim();
  }
  var visible = btns.filter(function(b) { return b.offsetParent !== null; }).map(function(b) { return b.textContent.trim().slice(0,30) + '|' + b.title; }).filter(function(s) { return s.length > 1; });
  return 'not_found visible_buttons=[' + visible.join(',') + ']';
})()`);

console.log('Result:', clickResult);

if (clickResult && clickResult.startsWith('clicked')) {
  console.log('Waiting 3s for study reload...');
  await new Promise(r => setTimeout(r, 3000));
}

await c.close();
