/**
 * Core indicator settings logic.
 */
import { evaluate, safeString } from '../connection.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

export async function setInputs({ entity_id, inputs: inputsRaw }) {
  const inputs = inputsRaw ? (typeof inputsRaw === 'string' ? JSON.parse(inputsRaw) : inputsRaw) : undefined;
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  if (!inputs || typeof inputs !== 'object' || Object.keys(inputs).length === 0) {
    throw new Error('inputs must be a non-empty object, e.g. { length: 50 }');
  }

  const inputsJson = JSON.stringify(inputs);

  const result = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var study = chart.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };
      var overrides = ${inputsJson};
      var updatedKeys = {};
      var missingKeys = [];

      // TM-395: write each input through its own property node — the same path
      // the Inputs dialog uses. The previous implementation read the whole
      // getInputValues() array, patched it and wrote it back via
      // setInputValues(); on large Pine scripts that call kills the study
      // ("Can't parse pine", inputs collapse to an empty list, unrecoverable).
      // Proven by experiment: the failure reproduces with an UNCHANGED array
      // and with system entries filtered out, so it is the array-write itself,
      // not the payload. Per-input setValue leaves the study healthy.
      var nodes = null;
      try {
        nodes = study.properties().childs().inputs.childs();
      } catch (e) {
        return { error: 'Cannot reach input properties: ' + (e && e.message ? e.message : String(e)) };
      }
      if (!nodes) return { error: 'Study exposes no input properties' };

      // TM-395: colour inputs are stored as CSS strings ("rgba(76,175,80,1)"),
      // while getInputValues() reports them as packed ABGR integers. Feeding the
      // integer straight into setValue() produces an invalid property value and
      // kills the study exactly like the array write did. Convert when the
      // current value is a colour string and the caller passed a number.
      function packedToCss(n) {
        var r = n & 0xFF, g = (n >> 8) & 0xFF, b = (n >> 16) & 0xFF, a = (n >>> 24) & 0xFF;
        // Round-trip through TradingView's own quantisation: it stores
        // transparency as an integer percent, so derive alpha back from it.
        var transp = Math.round(100 * (1 - a / 255));
        var alpha = (100 - transp) / 100;
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
      }

      for (var key in overrides) {
        if (!overrides.hasOwnProperty(key)) continue;
        var node = nodes[key];
        if (!node || typeof node.setValue !== 'function') {
          missingKeys.push(key);
          continue;
        }
        var value = overrides[key];
        var current = typeof node.value === 'function' ? node.value() : undefined;
        if (typeof value === 'number' && typeof current === 'string' &&
            (current.indexOf('rgba(') === 0 || current.charAt(0) === '#')) {
          value = packedToCss(value);
        }
        node.setValue(value);
        updatedKeys[key] = value;
      }

      // Never report success for a write that changed nothing: a silent no-op
      // here used to read as "applied" and cost hours of false diagnosis.
      if (Object.keys(updatedKeys).length === 0) {
        return { error: 'No input was written. Unknown keys: ' + missingKeys.join(', ') +
                        '. Use chart_get_state + the study metaInfo to get valid input ids.' };
      }
      return { updated_inputs: updatedKeys, unknown_keys: missingKeys };
    })()
  `);

  if (result && result.error) throw new Error(result.error);
  const out = { success: true, entity_id, updated_inputs: result.updated_inputs };
  if (result.unknown_keys && result.unknown_keys.length) out.unknown_keys = result.unknown_keys;
  return out;
}

export async function toggleVisibility({ entity_id, visible }) {
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  if (typeof visible !== 'boolean') throw new Error('visible must be a boolean (true or false)');

  const result = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var study = chart.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };
      study.setVisible(${visible});
      var actualVisible = study.isVisible();
      return { visible: actualVisible };
    })()
  `);

  if (result && result.error) throw new Error(result.error);
  return { success: true, entity_id, visible: result.visible };
}
