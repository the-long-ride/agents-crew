import assert from 'node:assert/strict';
import test from 'node:test';
import { presentError, presentHuman } from '../dist/cli/presenter.js';

test('human presenter colors semantic status only when requested', () => {
  const colored = presentHuman({ valid: true }, { color: true });
  assert.match(colored, /\u001b\[/u);
  assert.match(colored, /✓/u);
  const plain = presentHuman({ valid: true }, { color: false });
  assert.doesNotMatch(plain, /\u001b\[/u);
  assert.match(plain, /✓ Configuration valid/u);
});

test('human presenter formats doctor results as indented operator sections', () => {
  const output = presentHuman({
    binary_version: '0.0.2', runtime: 'v22.16.0', config_valid: true,
    git: { root: '/repo' },
    workers: [
      { id: 'codex-main', kind: 'cli', available: true, model: 'gpt-5.6' },
      { id: 'claude-review', kind: 'cli', available: false, model: 'sonnet', message: 'not found' },
    ],
    credentials: 'Secrets are not printed.',
  }, { color: false });
  assert.match(output, /^◆ Agents Crew · doctor/mu);
  assert.match(output, /  Environment\n    ✓ Config valid/u);
  assert.match(output, /  Workers\n    ✓ codex-main\s+cli\s+gpt-5\.6/u);
  assert.match(output, /    ! claude-review\s+cli\s+sonnet\s+not found/u);
  assert.match(output, /  Git\n    ✓ \/repo/u);
});

test('human presenter formats run and plugin reports without dumping raw JSON', () => {
  const run = presentHuman({
    run: { id: 'run-1234567890', status: 'paused', original_goal: 'Ship feature', iteration: 2, max_iterations: 8, tasks: {} },
    pending_actions: [], expired_actions: [],
  }, { color: false });
  assert.match(run, /^◆ Agents Crew · run/mu);
  assert.match(run, /  ‖ paused/u);
  assert.match(run, /  Goal\n    Ship feature/u);
  assert.doesNotMatch(run, /"original_goal"/u);

  const plugin = presentHuman({ host: 'opencode', files: [
    { path: '.opencode/commands/crew-run.md', action: 'created', message: 'installed' },
    { path: '.opencode/agents/agents-crew-reviewer.md', action: 'preserve', message: 'modified by user' },
  ] }, { color: false });
  assert.match(plugin, /^◆ Agents Crew · opencode/mu);
  assert.match(plugin, /    ✓ .*crew-run\.md/u);
  assert.match(plugin, /    ! .*reviewer\.md/u);
});

test('error presenter is compact and color optional', () => {
  assert.equal(presentError('bad config', { color: false }), '✗ bad config');
  assert.match(presentError('bad config', { color: true }), /\u001b\[/u);
});
