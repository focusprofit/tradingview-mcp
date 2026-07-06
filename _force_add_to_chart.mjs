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

  // Find and click the "Add to chart" button
  const result = await ev(`
    (function() {
      // Try multiple selectors for the Add to chart button
      var buttons = Array.from(document.querySelectorAll('button'));
      
      // Look for "Add to chart" button (not grayed out)
      var addBtn = buttons.find(b => 
        (b.textContent.trim() === 'Add to chart' || b.title === 'Add to chart') && !b.disabled
      );
      
      if (!addBtn) {
        // Try data-name attribute
        addBtn = document.querySelector('[data-name="add-to-chart"]:not([disabled])');
      }
      
      if (!addBtn) {
        // Scan all visible buttons for text match
        addBtn = buttons.find(b => 
          b.textContent.includes('Add to chart') && 
          b.offsetParent !== null  // visible
        );
      }
      
      if (addBtn) {
        addBtn.click();
        return { clicked: true, text: addBtn.textContent.trim(), title: addBtn.title };
      }
      
      // Debug: return all pine editor buttons
      var allBtns = buttons.filter(b => b.offsetParent !== null).map(b => ({
        text: b.textContent.trim().substring(0, 40),
        title: b.title,
        disabled: b.disabled,
        class: b.className.substring(0, 60)
      }));
      return { clicked: false, visible_buttons: allBtns.filter(b => b.text.length > 0).slice(0, 30) };
    })()
  `);
  
  console.log('Add to chart result:', JSON.stringify(result, null, 2));
  
  if (result && result.clicked) {
    // Wait a bit for the indicator to reload
    await new Promise(r => setTimeout(r, 3000));
    console.log('Waited 3s for indicator reload');
  }
  
  await client.close();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
