import CDP from 'chrome-remote-interface';
const client = await CDP({ host: 'localhost', port: 9222 });
const { Runtime } = client;

const result = await Runtime.evaluate({
  expression: `
    (function() {
      // Check for element with BOTH classes
      var combined = document.querySelectorAll('.monaco-editor.pine-editor-monaco');
      
      // Also look for pine-editor-monaco elements
      var pineMonaco = document.querySelectorAll('.pine-editor-monaco');
      var pineMonacoInfo = [];
      pineMonaco.forEach(function(el) {
        pineMonacoInfo.push({
          tagName: el.tagName,
          className: el.className.substring(0, 100),
          id: el.id || ''
        });
      });
      
      // Try to activate editor
      var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
      
      return {
        combinedCount: combined.length,
        pineMonacoCount: pineMonaco.length,
        pineMonacoInfo: pineMonacoInfo,
        bwbHasActivate: bwb && typeof bwb.activateScriptEditorTab === 'function'
      };
    })()
  `,
  returnByValue: true
});

console.log(JSON.stringify(result.result.value, null, 2));
await client.close();
