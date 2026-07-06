import CDP from 'chrome-remote-interface';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const CDP_PORT = 9222;
const PINE_FILE = '/root/projects/focusprofit/trademodel/index.pine';

const READ_BOUND_TITLE = `(function(){ var t=document.querySelector('.label-k49p41Es'); return t?t.textContent.trim():null; })()`;

const FIND_MONACO = `
  (function findMonacoEditor() {
    var container = document.querySelector('.monaco-editor.pine-editor-monaco');
    if (!container) return null;
    var el = container;
    var fiberKey;
    for (var i = 0; i < 20; i++) {
      if (!el) break;
      fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$'); });
      if (fiberKey) break;
      el = el.parentElement;
    }
    if (!fiberKey) return null;
    var current = el[fiberKey];
    for (var d = 0; d < 15; d++) {
      if (!current) break;
      if (current.memoizedProps && current.memoizedProps.value && current.memoizedProps.value.monacoEnv) {
        var env = current.memoizedProps.value.monacoEnv;
        if (env.editor && typeof env.editor.getEditors === 'function') {
          var editors = env.editor.getEditors();
          if (editors.length > 0) return { editor: editors[0], env: env };
        }
      }
      current = current.return;
    }
    return null;
  })()
`;

function sha256(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

async function main() {
  // Find chart target
  const resp = await fetch(`http://localhost:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const target = targets.find(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
    || targets.find(t => t.type === 'page' && /tradingview/i.test(t.url));
  
  if (!target) throw new Error('No TradingView chart target found');
  console.log('Target:', target.url.substring(0, 80));

  const client = await CDP({ host: 'localhost', port: CDP_PORT, target: target.id });
  await client.Runtime.enable();

  const ev = async (expr) => {
    const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('CDP eval error: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  // Read bound title BEFORE inject
  const boundTitle = await ev(READ_BOUND_TITLE);
  console.log('bound_title (before inject):', boundTitle);

  if (!boundTitle || !boundTitle.includes('DEV')) {
    console.error('STOP: bound_title is NOT DEV. Current:', boundTitle);
    await client.close();
    process.exit(1);
  }

  // Read file
  const fileContent = readFileSync(PINE_FILE, 'utf8');
  const fileSha = sha256(fileContent);
  console.log('File SHA-256:', fileSha);
  console.log('File size:', fileContent.length, 'chars,', fileContent.split('\n').length, 'lines');

  // Inject via Monaco setValue
  const escaped = JSON.stringify(fileContent);
  const setResult = await ev(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return 'monaco-not-found';
      m.editor.setValue(${escaped});
      return 'ok';
    })()
  `);
  console.log('setValue result:', setResult);
  if (setResult !== 'ok') throw new Error('Monaco setValue failed: ' + setResult);

  // Read back and verify
  const editorContent = await ev(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return null;
      return m.editor.getValue();
    })()
  `);
  
  if (!editorContent) throw new Error('getValue() returned null');
  const editorSha = sha256(editorContent);
  const verified = fileSha === editorSha;
  
  console.log('Editor SHA-256:', editorSha);
  console.log('verified:', verified);
  if (!verified) {
    console.error('SHA-256 MISMATCH — byte-exact verify FAILED');
    process.exit(2);
  }

  await client.close();
  console.log('INJECT OK: bound_title=' + boundTitle + ', verified=true');
}

main().catch(e => { console.error('INJECT FAILED:', e.message); process.exit(1); });
