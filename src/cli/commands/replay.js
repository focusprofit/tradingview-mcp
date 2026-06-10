import { register } from '../router.js';
import * as core from '../../core/replay.js';

register('replay', {
  description: 'Replay mode controls',
  subcommands: new Map([
    ['start', {
      description: 'Start replay mode',
      options: {
        date: { type: 'string', short: 'd', description: 'Start date (YYYY-MM-DD)' },
      },
      handler: (opts) => core.start({ date: opts.date }),
    }],
    ['step', {
      description: 'Advance one bar in replay',
      handler: () => core.step(),
    }],
    ['trace', {
      description: 'Advance N bars, dumping labels/tables to a JSONL file after every step',
      options: {
        steps: { type: 'string', short: 'n', description: 'Number of steps (default 1, max 500)' },
        filter: { type: 'string', short: 'f', description: 'Study name substring for dumps' },
        tables: { type: 'boolean', description: 'Also dump Pine tables (debug table)' },
        text: { type: 'string', short: 't', description: 'Only labels containing this text' },
        file: { type: 'string', description: 'Trace file path (JSONL, default auto under dumps/)' },
      },
      handler: (opts) => core.stepAndDump({ steps: opts.steps ? Number(opts.steps) : 1, study_filter: opts.filter, include_tables: opts.tables, labels_text_filter: opts.text, dump_file: opts.file }),
    }],
    ['stop', {
      description: 'Stop replay and return to realtime',
      handler: () => core.stop(),
    }],
    ['status', {
      description: 'Get current replay state',
      handler: () => core.status(),
    }],
    ['autoplay', {
      description: 'Toggle autoplay in replay mode',
      options: {
        speed: { type: 'string', short: 's', description: 'Autoplay delay in ms (lower = faster)' },
      },
      handler: (opts) => core.autoplay({ speed: opts.speed ? Number(opts.speed) : undefined }),
    }],
    ['trade', {
      description: 'Execute a trade in replay mode (buy, sell, close)',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Action required. Usage: tv replay trade buy');
        return core.trade({ action: positionals[0] });
      },
    }],
  ]),
});
