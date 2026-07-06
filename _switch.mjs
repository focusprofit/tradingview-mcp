import { openScriptGui } from './src/core/pine.js';
const name = process.argv[2];
if (!name) { console.error('usage: node _switch.mjs "<Script Name>"'); process.exit(2); }
try {
  const r = await openScriptGui({ name, reason: 'main-agent self-switch (cloud MCP updated to TM-261 pine_open_gui)' });
  console.log('OK ' + JSON.stringify(r));
  process.exit(0);
} catch (e) {
  console.error('ERR ' + (e && e.message || e));
  process.exit(1);
}
