import CDP from 'chrome-remote-interface';
const client = await CDP({ host: 'localhost', port: 9222 });
const { Runtime } = client;

const result = await Runtime.evaluate({
  expression: `
    (function() {
      // Find and click the close button on any open dialog
      var closeBtn = document.querySelector('[data-dialog-name] button[aria-label="Close"]')
        || document.querySelector('.dialog-component__close-button')
        || document.querySelector('[class*="close"] button')
        || document.querySelector('[class*="closeButton"]')
        || document.querySelector('.tv-dialog__close');
      
      // Also try finding the X in the Open script dialog
      var dialogs = document.querySelectorAll('[role="dialog"]');
      var dialogInfo = Array.from(dialogs).map(d => d.className.substring(0, 80));
      
      // Try pressing Escape key
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true}));
      
      return {
        closeBtnFound: !!closeBtn,
        dialogs: dialogs.length,
        dialogInfo: dialogInfo
      };
    })()
  `,
  returnByValue: true
});

console.log(JSON.stringify(result.result.value, null, 2));
await client.close();
