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
    var fiber = el[fiberKey];
    for (var j = 0; j < 100; j++) {
      if (!fiber) break;
      var props = fiber.memoizedProps;
      if (props && props.editor && typeof props.editor.setValue === 'function') {
        return fiber;
      }
      fiber = fiber.return;
    }
    return null;
  })()
`;

async function main() {
  const source = readFileSync(PINE_FILE, 'utf8');
  const fileSha = createHash('sha256').update(source).digest('hex');
  console.log(`File SHA: ${fileSha}`);
  console.log(`File lines: ${source.split('\n').length}`);

  const client = await CDP({ port: CDP_PORT });
  await client.Runtime.enable();

  // Check bound title
  const titleResult = await client.Runtime.evaluate({ expression: READ_BOUND_TITLE, returnByValue: true });
  const title = titleResult.result.value;
  console.log(`Bound title: ${title}`);
  if (!title || !title.includes('DEV')) {
    console.error('ERROR: Editor is NOT DEV. Aborting inject.');
    await client.close();
    process.exit(1);
  }

  // Find Monaco editor and inject
  const fiberResult = await client.Runtime.evaluate({ expression: FIND_MONACO, returnByValue: false });
  const fiberId = fiberResult.result.objectId;
  if (!fiberId) {
    console.error('ERROR: Monaco editor not found.');
    await client.close();
    process.exit(1);
  }

  // Get editor from fiber
  const editorResult = await client.Runtime.callFunctionOn({
    functionDeclaration: `function() { return this.memoizedProps.editor; }`,
    objectId: fiberId,
    returnByValue: false
  });
  const editorId = editorResult.result.objectId;

  // Set value
  const escaped = JSON.stringify(source);
  await client.Runtime.callFunctionOn({
    functionDeclaration: `function(src) { this.setValue(src); }`,
    objectId: editorId,
    arguments: [{ value: source }],
    returnByValue: true
  });

  // Verify by reading back
  const readBack = await client.Runtime.callFunctionOn({
    functionDeclaration: `function() { return this.getValue(); }`,
    objectId: editorId,
    returnByValue: true
  });
  const editorContent = readBack.result.value;
  const editorSha = createHash('sha256').update(editorContent).digest('hex');
  console.log(`Editor SHA: ${editorSha}`);
  const verified = fileSha === editorSha;
  console.log(`Verified: ${verified}`);
  if (!verified) {
    console.error('SHA MISMATCH — inject failed');
    process.exit(1);
  }

  await client.close();
  console.log('Inject complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
