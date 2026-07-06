import CDP from 'chrome-remote-interface';

const CDP_PORT = 9222;

async function main() {
  const resp = await fetch(`http://localhost:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const target = targets.find(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
    || targets.find(t => t.type === 'page' && /tradingview/i.test(t.url));
  
  if (!target) throw new Error('No TradingView chart target found');
  const client = await CDP({ host: 'localhost', port: CDP_PORT, target: target.id });
  await client.Runtime.enable();

  const ev = async (expr) => {
    const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('CDP eval error: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  // Check current Pine editor state - find "Add to chart" button
  const buttonInfo = await ev(`
    (function() {
      // Try to find "Add to chart" button in Pine editor toolbar
      var buttons = Array.from(document.querySelectorAll('button'));
      var addBtn = buttons.find(b => b.textContent.includes('Add to chart') || b.title === 'Add to chart');
      if (addBtn) return { found: true, text: addBtn.textContent.trim(), disabled: addBtn.disabled };
      
      // Try data-name attribute
      var btn2 = document.querySelector('[data-name="add-to-chart"]');
      if (btn2) return { found: true, text: btn2.textContent.trim(), disabled: btn2.disabled };
      
      // List all pine editor buttons
      var pineToolbar = document.querySelector('.pine-toolbar') || document.querySelector('.editor-top-bar-buttons');
      if (pineToolbar) {
        var allBtns = Array.from(pineToolbar.querySelectorAll('button'));
        return { found: false, toolbar_buttons: allBtns.map(b => ({ text: b.textContent.trim(), title: b.title, disabled: b.disabled })) };
      }
      return { found: false, all_pine_buttons: buttons.filter(b => b.closest('.pine-editor') || b.closest('.editor')).map(b => ({ text: b.textContent.trim().substring(0, 30), title: b.title })) };
    })()
  `);
  console.log('Button info:', JSON.stringify(buttonInfo, null, 2));

  await client.close();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
