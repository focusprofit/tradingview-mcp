import CDP from 'chrome-remote-interface';
const client = await CDP({ host: 'localhost', port: 9222 });
const { Runtime } = client;

const result = await Runtime.evaluate({
  expression: `
    (function() {
      // Find the dialog wrapper
      var wrapper = document.querySelector('.wrapper-b8SxMnzX');
      if (!wrapper) return { found: false };
      
      // Look for close button inside it
      var allButtons = wrapper.querySelectorAll('button');
      var buttonInfo = Array.from(allButtons).map(b => ({
        text: b.textContent.trim().substring(0, 30),
        ariaLabel: b.getAttribute('aria-label') || '',
        class: b.className.substring(0, 60)
      }));
      
      // Try clicking any close/dismiss button
      var closeBtn = wrapper.querySelector('[aria-label="Close"]')
        || wrapper.querySelector('[aria-label="close"]')
        || Array.from(allButtons).find(b => b.getAttribute('aria-label') === 'Close' || b.textContent.trim() === '×');
      
      if (closeBtn) closeBtn.click();
      
      return {
        found: true,
        buttons: buttonInfo,
        closeBtnFound: !!closeBtn
      };
    })()
  `,
  returnByValue: true
});

console.log(JSON.stringify(result.result.value, null, 2));
await client.close();
