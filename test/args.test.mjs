import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs } from '../dist/cli/args.js';

test('parses global flags and durable template fields', () => {
  const parsed = parseArgs(['--workspace', '/repo', '--json', 'start', 'fullstack-review', '--goal', 'ship', '--expectation', 'compatible', '--acceptance', 'tests pass']);
  assert.equal(parsed.workspace, '/repo');
  assert.equal(parsed.json, true);
  assert.equal(parsed.command, 'start');
  assert.deepEqual(parsed.args.expectations, ['compatible']);
});

test('run selectors accept positional and --run forms', () => {
  assert.equal(parseArgs(['resume', 'run-1']).args.run_id, 'run-1');
  assert.equal(parseArgs(['status', '--run', 'run-2']).args.run_id, 'run-2');
});

test('argument parser handles booleans, nested commands, and invalid values', () => {
  assert.throws(() => parseArgs([]), /missing command/);
  assert.throws(() => parseArgs(['--workspace']), /requires a value/);
  assert.equal(parseArgs(['ui', '--port', '4815', '--no-open']).args.port, 4815);
  assert.equal(parseArgs(['plugin', 'install', 'codex', '--force']).args.force, true);
  assert.deepEqual(parseArgs(['worker', 'run', 'worker-a', 'task.json']).args.positional, ['worker-a', 'task.json']);
  assert.equal(parseArgs(['approve', 'approval-1', '--run', 'run-1']).args.approval_id, 'approval-1');
  assert.equal(parseArgs(['other', 'a']).args.positional[0], 'a');
});
