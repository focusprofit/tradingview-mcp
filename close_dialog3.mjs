import CDP from 'chrome-remote-interface';
const client = await CDP({ host: 'localhost', port: 9222 });
const { Runtime } = client;

const result = await Runtime.evaluate({
  expression: `
    (function() {
      var wrapper = document.querySelector('.wrapper-b8SxMnzX');
      if (!wrapper) return { found: false };
      
      // Click "Close menu" button
      var allButtons = wrapper.querySelectorAll('button');
      var closeMenuBtn = Array.from(allButtons).find(b => b.textContent.trim() === 'Close menu');
      if (closeMenuBtn) {
        closeMenuBtn.click();
        return { clicked: 'Close menu' };
      }
      
      // Try first button anyway
      if (allButtons[0]) {
        allButtons[0].click();
        return { clicked: 'first button: ' + allButtons[0].textContent.trim() };
      }
      
      return { found: true, noButton: true };
    })()
  `,
  returnByValue: true
});

console.log(JSON.stringify(result.result.value, null, 2));
await client.close();
