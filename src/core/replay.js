/**
 * Core replay mode logic.
 */
import { evaluate as _evaluate, getReplayApi as _getReplayApi } from '../connection.js';

export const VALID_AUTOPLAY_DELAYS = [100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000];

function wv(path) {
  return `(function(){ var v = ${path}; return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; })()`;
}

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    getReplayApi: deps?.getReplayApi || _getReplayApi,
  };
}

// The "Continue your last replay?" dialog (`[data-name="warning-dialog"]`) pops up when entering
// replay while a saved session exists. It overlays the chart and BLOCKS data_get_pine_* reads
// (study_count:0) until dismissed — the dominant cause of slow/flaky regression runs (TM-260).
// "Start new" discards the stale saved replay (so selectDate() controls the date and the prompt
// does not recur); "Continue" would jump to the saved position (wrong date). Default: discard.
function dismissDialogJS(label) {
  return `(function(){
    var dlg = document.querySelector('[data-name="warning-dialog"]');
    if (!dlg || dlg.offsetParent === null) return { present: false, dismissed: false };
    if (!/last replay/i.test(dlg.textContent || '')) return { present: false, dismissed: false };
    var btns = dlg.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || '').trim() === ${JSON.stringify(label)}) { btns[i].click(); return { present: true, dismissed: true }; }
    }
    return { present: true, dismissed: false };
  })()`;
}

export async function dismissReplayDialog({ label = 'Start new', tries = 6, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  for (let i = 0; i < tries; i++) {
    const r = await evaluate(dismissDialogJS(label)).catch(() => null);
    if (r && r.dismissed) { await new Promise(res => setTimeout(res, 150)); return true; }
    await new Promise(res => setTimeout(res, 120));
  }
  return false;
}

export async function start({ date, _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const available = await evaluate(wv(`${rp}.isReplayAvailable()`));
  if (!available) throw new Error('Replay is not available for the current symbol/timeframe');

  // selectDate() is a no-op on an already-active replay session — without stopping first,
  // replay_start(newDate) silently keeps the previous/saved position (TM-260). Stop, then
  // discard the "Continue your last replay?" prompt so selectDate() below controls the date.
  const alreadyStarted = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (alreadyStarted) {
    try { await evaluate(`${rp}.stopReplay()`); } catch {}
    await dismissReplayDialog({ label: 'Start new', _deps });
    await new Promise(r => setTimeout(r, 250));
  }

  await evaluate(`${rp}.showReplayToolbar()`);

  // Discard the "Continue your last replay?" prompt up front so it neither blocks the chart
  // nor overrides selectDate() with the saved position (TM-260).
  await dismissReplayDialog({ label: 'Start new', _deps });

  // selectDate() is async — it calls enableReplayMode() then _onPointSelected()
  // which initializes the server-side replay session. Must be awaited inside the
  // page context, otherwise the promise is fire-and-forget and replay state says
  // "started" but stepping doesn't work (issue #26).
  if (date) {
    const ts = new Date(date).getTime();
    if (isNaN(ts)) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD format.`);
    await evaluate(`${rp}.selectDate(${ts}).then(function() { return 'ok'; })`);
  } else {
    await evaluate(`${rp}.selectFirstAvailableDate()`);
  }

  // Poll until replay is fully initialized: isReplayStarted AND currentDate is set.
  // selectDate()'s promise resolves before the data series is ready, so we need
  // to wait for currentDate to become non-null before stepping will work.
  let started = false;
  let currentDate = null;
  for (let i = 0; i < 30; i++) {
    // The prompt can re-appear during init — keep it dismissed so the chart stays interactable.
    await evaluate(dismissDialogJS('Start new')).catch(() => {});
    started = await evaluate(wv(`${rp}.isReplayStarted()`));
    currentDate = await evaluate(wv(`${rp}.currentDate()`));
    if (started && currentDate !== null) break;
    await new Promise(r => setTimeout(r, 250));
  }

  if (!started) {
    try { await evaluate(`${rp}.stopReplay()`); } catch {}
    throw new Error('Replay failed to start. The selected date may not have data for this timeframe. Try a more recent date or a higher timeframe (e.g., Daily).');
  }

  return { success: true, replay_started: true, date: date || '(first available)', current_date: currentDate };
}

export async function step({ _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  const before = await evaluate(wv(`${rp}.currentDate()`));
  await evaluate(`${rp}.doStep()`);
  // doStep() is async internally — currentDate takes ~500ms to update.
  // Poll until it changes or timeout after 3s.
  let currentDate = before;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 250));
    currentDate = await evaluate(wv(`${rp}.currentDate()`));
    if (currentDate !== before) break;
  }
  return { success: true, action: 'step', current_date: currentDate };
}

export async function autoplay({ speed, _deps } = {}) {
  // Validate BEFORE any CDP calls — invalid values corrupt cloud account state permanently
  if (speed > 0 && !VALID_AUTOPLAY_DELAYS.includes(speed))
    throw new Error(`Invalid autoplay delay ${speed}ms. Valid values: ${VALID_AUTOPLAY_DELAYS.join(', ')}`);

  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  if (speed > 0) {
    await evaluate(`${rp}.changeAutoplayDelay(${speed})`);
  }
  await evaluate(`${rp}.toggleAutoplay()`);
  const isAutoplay = await evaluate(wv(`${rp}.isAutoplayStarted()`));
  const currentDelay = await evaluate(wv(`${rp}.autoplayDelay()`));
  return { success: true, autoplay_active: !!isAutoplay, delay_ms: currentDelay };
}

export async function stop({ _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) {
    return { success: true, action: 'already_stopped' };
  }
  await evaluate(`${rp}.stopReplay()`);
  // Defensive: clear any lingering "Continue your last replay?" prompt so the next data read
  // is not blocked (TM-260).
  await dismissReplayDialog({ label: 'Start new', _deps });
  return { success: true, action: 'replay_stopped' };
}

export async function trade({ action, _deps }) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');

  if (action === 'buy') await evaluate(`${rp}.buy()`);
  else if (action === 'sell') await evaluate(`${rp}.sell()`);
  else if (action === 'close') await evaluate(`${rp}.closePosition()`);
  else throw new Error('Invalid action. Use: buy, sell, or close');

  const position = await evaluate(wv(`${rp}.position()`));
  const pnl = await evaluate(wv(`${rp}.realizedPL()`));
  return { success: true, action, position, realized_pnl: pnl };
}

export async function status({ _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const st = await evaluate(`
    (function() {
      var r = ${rp};
      function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
      return {
        is_replay_available: unwrap(r.isReplayAvailable()),
        is_replay_started: unwrap(r.isReplayStarted()),
        is_autoplay_started: unwrap(r.isAutoplayStarted()),
        replay_mode: unwrap(r.replayMode()),
        current_date: unwrap(r.currentDate()),
        autoplay_delay: unwrap(r.autoplayDelay()),
      };
    })()
  `);
  const pos = await evaluate(wv(`${rp}.position()`));
  const pnl = await evaluate(wv(`${rp}.realizedPL()`));
  return { success: true, ...st, position: pos, realized_pnl: pnl };
}

// TM-261: one call = N replay steps with an automatic state dump after each
// step (labels with resolved time, optionally Pine tables — e.g. a debug
// table). Records are appended as JSONL to a file under <repo>/dumps so long
// traces never flow through the agent context. Replaces the
// step→labels→tables call chain per bar that made traces painfully slow.
export async function stepAndDump({ steps = 1, study_filter, include_tables = false, dump_file, max_labels = 40, labels_text_filter, _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const { getPineLabels, getPineTables, resolveDumpPath } = await import('./data.js');
  const { appendFileSync, mkdirSync } = await import('fs');
  const { dirname } = await import('path');

  const n = Math.min(Math.max(1, Number(steps) || 1), 500);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');

  const path = resolveDumpPath(dump_file, 'replay_trace', '.jsonl');
  mkdirSync(dirname(path), { recursive: true });

  let last = null;
  let stepsDone = 0;
  let prevDate = await evaluate(wv(`${rp}.currentDate()`));
  let stalled = false;

  for (let i = 0; i < n; i++) {
    const st = await step({ _deps });
    if (st.current_date === prevDate) { stalled = true; break; } // end of data / replay stopped advancing
    prevDate = st.current_date;

    const rec = { step: i + 1, replay_date: st.current_date };
    try {
      const labels = await getPineLabels({ study_filter, max_labels, text_filter: labels_text_filter });
      rec.labels = labels.studies;
    } catch (e) { rec.labels_error = e.message; }
    if (include_tables) {
      try { rec.tables = (await getPineTables({ study_filter })).studies; }
      catch (e) { rec.tables_error = e.message; }
    }
    appendFileSync(path, JSON.stringify(rec) + '\n');
    last = rec;
    stepsDone++;
  }

  return { success: true, steps_requested: n, steps_done: stepsDone, stalled, dump_file: path, last };
}
