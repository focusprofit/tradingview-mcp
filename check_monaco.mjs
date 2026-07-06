import CDP from 'chrome-remote-interface';

const client = await CDP({ host: 'localhost', port: 9222 });
const { Runtime } = client;

const result = await Runtime.evaluate({
  expression: `
    (function() {
      var monacoEls = document.querySelectorAll('[class*="monaco"]');
      var pineEls = document.querySelectorAll('[class*="pine-editor"]');
      var classes = new Set();
      monacoEls.forEach(function(el) {
        var cls = el.className;
        if (typeof cls === 'string') cls.split(' ').forEach(function(c) { if (c.includes('monaco') || c.includes('pine')) classes.add(c); });
      });
      pineEls.forEach(function(el) {
        var cls = el.className;
        if (typeof cls === 'string') cls.split(' ').forEach(function(c) { classes.add(c); });
      });
      
      var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
      var bwbMethods = bwb ? Object.getOwnPropertyNames(Object.getPrototypeOf(bwb)).filter(m => m.includes('pine') || m.includes('editor') || m.includes('script') || m.includes('show') || m.includes('activate')) : [];
      
      return {
        monacoCount: monacoEls.length,
        pineEditorCount: pineEls.length,
        classes: Array.from(classes).slice(0, 50),
        bwbAvailable: !!bwb,
        bwbMethods: bwbMethods
      };
    })()
  `,
  returnByValue: true
});

console.log(JSON.stringify(result.result.value, null, 2));
await client.close();
