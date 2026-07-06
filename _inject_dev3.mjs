import CDP from 'chrome-remote-interface';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const CDP_PORT = 9222;
const PINE_FILE = '/tmp/claude-0/-root-projects-focusprofit-trademodel/1d85ee4a-88ba-4c91-8054-bebeec37e251/scratchpad/dev_index.pine';
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

const ENSURE_OPEN = `
  (function() {
    var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
    if (bwb) {
      if (typeof bwb.activateScriptEditorTab === 'function') bwb.activateScriptEditorTab();
      else if (typeof bwb.showWidget === 'function') bwb.showWidget('pine-editor');
    }
    var btn = document.querySelector('[aria-label="Pine"]') || document.querySelector('[data-name="pine-dialog-button"]');
    if (btn) btn.click();
    return 'triggered';
  })()
`;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const source = readFileSync(PINE_FILE, 'utf8');
  const fileSha = createHash('sha256').update(source).digest('hex');
  console.log(`File SHA: ${fileSha}`);

  const client = await CDP({ port: CDP_PORT });
  await client.Runtime.enable();

  // Check bound title
  const titleResult = await client.Runtime.evaluate({ expression: READ_BOUND_TITLE, returnByValue: true });
  const title = titleResult.result.value;
  console.log(`Bound title: ${title}`);
  if (!title || !title.includes('DEV')) {
    console.error('ERROR: Not DEV. Aborting.'); await client.close(); process.exit(1);
  }

  // Ensure Pine Editor is open
  let editorFound = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const checkExpr = `(function(){ return (${FIND_MONACO}) !== null; })()`;
    const checkResult = await client.Runtime.evaluate({ expression: checkExpr, returnByValue: true });
    if (checkResult.result.value) { editorFound = true; break; }
    console.log(`Attempt ${attempt+1}: Editor not found, triggering open...`);
    await client.Runtime.evaluate({ expression: ENSURE_OPEN, returnByValue: true });
    await sleep(2000);
  }

  if (!editorFound) {
    console.error('ERROR: Monaco editor not accessible after retry');
    await client.close(); process.exit(1);
  }

  console.log('Monaco found. Injecting source...');
  // Get editor object via getEditors
  const editorObjResult = await client.Runtime.evaluate({
    expression: `(function(){ var m = ${FIND_MONACO}; return m ? 'found' : 'null'; })()`,
    returnByValue: true
  });
  console.log(`Editor object: ${editorObjResult.result.value}`);

  // Do the setValue via the same mechanism
  const setResult = await client.Runtime.evaluate({
    expression: `(function(src){ var m = ${FIND_MONACO}; if(!m) return 'no editor'; m.editor.setValue(src); return 'ok'; })(${JSON.stringify(source)})`,
    returnByValue: true
  });
  console.log(`setValue: ${setResult.result.value}`);
  if (setResult.result.value !== 'ok') {
    console.error('setValue failed'); await client.close(); process.exit(1);
  }

  // Verify
  const readBack = await client.Runtime.evaluate({
    expression: `(function(){ var m = ${FIND_MONACO}; if(!m) return null; return m.editor.getValue(); })()`,
    returnByValue: true
  });
  const editorContent = readBack.result.value;
  if (!editorContent) { console.error('Read-back null'); await client.close(); process.exit(1); }
  const editorSha = createHash('sha256').update(editorContent).digest('hex');
  console.log(`Editor SHA: ${editorSha}`);
  const verified = fileSha === editorSha;
  console.log(`Verified: ${verified}`);
  if (!verified) { console.error('SHA MISMATCH'); await client.close(); process.exit(1); }

  await client.close();
  console.log('INJECT COMPLETE');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
