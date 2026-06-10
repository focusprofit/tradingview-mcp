import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/replay.js';

export function registerReplayTools(server) {
  server.tool('replay_start', 'Start bar replay mode, optionally at a specific date', {
    date: z.string().optional().describe('Date to start replay from (YYYY-MM-DD format). If omitted, selects first available date.'),
  }, async ({ date }) => {
    try { return jsonResult(await core.start({ date })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_step', 'Advance one bar in replay mode', {}, async () => {
    try { return jsonResult(await core.step()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_step_and_dump', 'Advance N bars in replay mode, dumping indicator state (labels with bar time, optionally Pine tables such as a debug table) to a JSONL trace file after every step. One call per trace series instead of step→read chains per bar.', {
    steps: z.coerce.number().optional().describe('Number of replay steps to perform (default 1, max 500)'),
    study_filter: z.string().optional().describe('Substring to match study name for the dumps (e.g. "Trade Model")'),
    include_tables: z.coerce.boolean().optional().describe('Also dump Pine tables after every step (e.g. an indicator debug table)'),
    labels_text_filter: z.string().optional().describe('Only labels whose text contains this substring (e.g. "HL")'),
    max_labels: z.coerce.number().optional().describe('Max labels per dump record (default 40)'),
    dump_file: z.string().optional().describe('Trace file path (JSONL). Omit for an auto-named file under <repo>/dumps'),
  }, async ({ steps, study_filter, include_tables, labels_text_filter, max_labels, dump_file }) => {
    try { return jsonResult(await core.stepAndDump({ steps, study_filter, include_tables, labels_text_filter, max_labels, dump_file })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_autoplay', 'Toggle autoplay in replay mode, optionally set speed', {
    speed: z.coerce.number().optional().describe('Autoplay delay in ms (lower = faster). Valid values: 100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000. Leave empty to just toggle.'),
  }, async ({ speed }) => {
    try { return jsonResult(await core.autoplay({ speed })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_stop', 'Stop replay and return to realtime', {}, async () => {
    try { return jsonResult(await core.stop()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_trade', 'Execute a trade action in replay mode (buy, sell, or close position)', {
    action: z.string().describe('Trade action: buy, sell, or close'),
  }, async ({ action }) => {
    try { return jsonResult(await core.trade({ action })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_status', 'Get current replay mode status', {}, async () => {
    try { return jsonResult(await core.status()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
