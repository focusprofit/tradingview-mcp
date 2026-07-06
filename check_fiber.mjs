import CDP from 'chrome-remote-interface';
const client = await CDP({ host: 'localhost', port: 9222 });
const { Runtime } = client;

const result = await Runtime.evaluate({
  expression: `
    (function() {
      // Check BOTH monaco-editor.pine-editor-monaco elements
      var containers = document.querySelectorAll('.monaco-editor.pine-editor-monaco');
      var results = [];
      
      containers.forEach(function(container, idx) {
        var el = container;
        var fiberKey = null;
        var depth = 0;
        for (var i = 0; i < 20; i++) {
          if (!el) break;
          fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$'); });
          if (fiberKey) { depth = i; break; }
          el = el.parentElement;
        }
        
        if (fiberKey) {
          // Try to traverse to find monacoEnv
          var current = el[fiberKey];
          var envFound = false;
          var editorsCount = 0;
          for (var d = 0; d < 15; d++) {
            if (!current) break;
            if (current.memoizedProps && current.memoizedProps.value && current.memoizedProps.value.monacoEnv) {
              var env = current.memoizedProps.value.monacoEnv;
              if (env.editor && typeof env.editor.getEditors === 'function') {
                envFound = true;
                editorsCount = env.editor.getEditors().length;
              }
              break;
            }
            current = current.return;
          }
          results.push({ idx, fiberKey: fiberKey.substring(0, 30), depth, envFound, editorsCount });
        } else {
          results.push({ idx, fiberKey: null, depth: -1, envFound: false, editorsCount: 0, className: container.className });
        }
      });
      
      return results;
    })()
  `,
  returnByValue: true
});

console.log(JSON.stringify(result.result.value, null, 2));
await client.close();
