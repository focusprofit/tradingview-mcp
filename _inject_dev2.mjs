import CDP from 'chrome-remote-interface';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const CDP_PORT = 9222;
const PINE_FILE = '/tmp/claude-0/-root-projects-focusprofit-trademodel/1d85ee4a-88ba-4c91-8054-bebeec37e251/scratchpad/dev_index.pine';

const READ_BOUND_TITLE = `(function(){ var t=document.querySelector('.label-k49p41Es'); return t?t.textContent.trim():null; })()`;

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

  // Try monaco API directly
  const monacoCheck = await client.Runtime.evaluate({
    expression: `typeof window.monaco !== 'undefined' ? Object.keys(window.monaco).join(',') : 'no monaco'`,
    returnByValue: true
  });
  console.log(`Monaco API: ${monacoCheck.result.value}`);

  // Try to get editor via monaco.editor.getEditors()
  const editorsExpr = `
    (function() {
      try {
        if (window.monaco && window.monaco.editor) {
          var editors = window.monaco.editor.getEditors();
          return editors ? editors.length : 'null editors';
        }
        return 'no monaco.editor';
      } catch(e) { return 'err: ' + e.message; }
    })()
  `;
  const editorsResult = await client.Runtime.evaluate({ expression: editorsExpr, returnByValue: true });
  console.log(`Monaco editors count: ${editorsResult.result.value}`);

  if (typeof editorsResult.result.value === 'number' && editorsResult.result.value > 0) {
    // Use monaco.editor.getEditors()[0].setValue
    const setResult = await client.Runtime.evaluate({
      expression: `(function(src) { window.monaco.editor.getEditors()[0].setValue(src); return 'ok'; })(${JSON.stringify(source)})`,
      returnByValue: true
    });
    console.log(`Set result: ${setResult.result.value}`);

    // Read back and verify
    const readBack = await client.Runtime.evaluate({
      expression: `window.monaco.editor.getEditors()[0].getValue()`,
      returnByValue: true
    });
    const editorContent = readBack.result.value;
    const editorSha = createHash('sha256').update(editorContent).digest('hex');
    console.log(`Editor SHA: ${editorSha}`);
    const verified = fileSha === editorSha;
    console.log(`Verified: ${verified}`);
    if (!verified) { console.error('SHA MISMATCH'); process.exit(1); }
    console.log('Inject complete.');
  } else {
    console.error('No Monaco editors found via API');
    process.exit(1);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
