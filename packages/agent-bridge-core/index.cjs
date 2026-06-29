#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_STATE_DIRECTORY_NAME = '.agents-crew';
const DEFAULT_REVIEW_LIMIT = 3;
const DEFAULT_REVIEW_SCHEMA_PATH = path.join(__dirname, 'agent-bridge-review.schema.json');

function createAntigravityAdapter() {
  return {
    name: 'antigravity',
    validateHookInput(task, hookInput) {
      if (hookInput.fullyIdle !== true) {
        return { decision: 'skip', reason: 'Antigravity still has active work.' };
      }
      if (hookInput.terminationReason !== 'model_stop') {
        return {
          decision: 'skip',
          reason: `Review skipped for termination reason: ${hookInput.terminationReason || 'unknown'}.`,
        };
      }
      if (hookInput.conversationId && hookInput.conversationId !== task.conversationId) {
        throw new Error('Agent conversation does not match TASK.json');
      }
      return { decision: 'review' };
    },
    stop(reason) {
      return { decision: 'stop', reason };
    },
    continue(reason) {
      return { decision: 'continue', reason };
    },
  };
}

const ADAPTER_FACTORIES = {
  antigravity: createAntigravityAdapter,
};

function parseArguments(argv, env = process.env) {
  const options = {
    command: argv[0] || 'status',
    adapterName: env.AGENT_BRIDGE_ADAPTER || 'antigravity',
    json: false,
    taskPath: null,
    workspace: process.cwd(),
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--workspace' || argument === '--task' || argument === '--adapter') {
      index += 1;
      if (!argv[index]) throw new Error(`${argument} requires a value`);
      if (argument === '--workspace') options.workspace = argv[index];
      if (argument === '--task') options.taskPath = argv[index];
      if (argument === '--adapter') options.adapterName = argv[index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  options.workspace = path.resolve(options.workspace);
  if (options.taskPath) options.taskPath = path.resolve(options.workspace, options.taskPath);
  return options;
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function writeJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(workspace, args, encoding = null) {
  const result = spawnSync('git', args, {
    cwd: workspace,
    encoding,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr;
    throw new Error(`git ${args.join(' ')} failed: ${String(stderr).trim()}`);
  }
  return result.stdout;
}

function splitNull(buffer) {
  return buffer
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((item) => item.replaceAll('/', path.sep));
}

function isRuntimePath(relativePath, stateDirectoryName) {
  const normalized = relativePath.replaceAll('\\', '/');
  return normalized === stateDirectoryName || normalized.startsWith(`${stateDirectoryName}/`);
}

function getSnapshot(workspace, stateDirectoryName) {
  const repositoryRoot = path.resolve(String(runGit(workspace, ['rev-parse', '--show-toplevel'], 'utf8')).trim());
  const baseCommit = String(runGit(repositoryRoot, ['rev-parse', 'HEAD'], 'utf8')).trim();
  const trackedFiles = splitNull(runGit(repositoryRoot, ['diff', '--name-only', '-z', 'HEAD']));
  const untrackedFiles = splitNull(
    runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
  ).filter((file) => !isRuntimePath(file, stateDirectoryName));
  const changedFiles = [...new Set([...trackedFiles, ...untrackedFiles])].sort((left, right) =>
    left.localeCompare(right),
  );

  const hash = crypto.createHash('sha256');
  hash.update(repositoryRoot);
  hash.update('\0');
  hash.update(baseCommit);
  hash.update('\0');
  hash.update(runGit(repositoryRoot, ['diff', '--binary', '--no-ext-diff', 'HEAD']));
  for (const relativePath of untrackedFiles.sort()) {
    hash.update('\0untracked\0');
    hash.update(relativePath);
    const absolutePath = path.join(repositoryRoot, relativePath);
    if (fs.statSync(absolutePath).isFile()) hash.update(fs.readFileSync(absolutePath));
  }

  return { repositoryRoot, baseCommit, changedFiles, diffHash: hash.digest('hex') };
}

function normalizeTaskDraft(task) {
  if (!task || typeof task !== 'object') throw new Error('Task draft must be an object');
  const conversationId = task.conversationId || task.antigravityConversationId;
  return {
    ...task,
    conversationId,
  };
}

function validateTaskDraft(task) {
  const normalized = normalizeTaskDraft(task);
  const stringFields = ['taskId', 'goal', 'implementationSummary', 'conversationId'];
  for (const field of stringFields) {
    if (typeof normalized[field] !== 'string' || !normalized[field].trim()) {
      throw new Error(`Task field ${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(normalized.acceptanceCriteria) || normalized.acceptanceCriteria.length === 0) {
    throw new Error('Task field acceptanceCriteria must be a non-empty array');
  }
  if (!Array.isArray(normalized.tests)) throw new Error('Task field tests must be an array');
  return normalized;
}

function validateStoredTask(task) {
  validateTaskDraft(task);
  if (task.schemaVersion !== 1) throw new Error('Unsupported TASK.json schemaVersion');
  if (typeof task.diffHash !== 'string' || !/^[a-f0-9]{64}$/.test(task.diffHash)) {
    throw new Error('TASK.json diffHash is invalid');
  }
  if (!Number.isInteger(task.reviewCycle) || task.reviewCycle < 0) {
    throw new Error('TASK.json reviewCycle is invalid');
  }
}

function validateReview(review) {
  const allowedStatuses = new Set(['pass', 'findings', 'needs_human']);
  const allowedSeverities = new Set(['critical', 'high', 'medium', 'low']);
  if (!review || typeof review !== 'object' || !allowedStatuses.has(review.status)) {
    throw new Error('Codex review status is invalid');
  }
  if (typeof review.summary !== 'string' || !review.summary.trim()) {
    throw new Error('Codex review summary is invalid');
  }
  if (!Array.isArray(review.findings)) throw new Error('Codex review findings must be an array');
  if (review.status === 'pass' && review.findings.length !== 0) {
    throw new Error('Passing Codex review cannot contain findings');
  }
  if (review.status === 'findings' && review.findings.length === 0) {
    throw new Error('Codex findings review must contain at least one finding');
  }
  for (const finding of review.findings) {
    if (!finding || typeof finding !== 'object' || !allowedSeverities.has(finding.severity)) {
      throw new Error('Codex finding severity is invalid');
    }
    for (const field of ['file', 'title', 'evidence', 'requiredFix']) {
      if (typeof finding[field] !== 'string' || !finding[field].trim()) {
        throw new Error(`Codex finding ${field} is invalid`);
      }
    }
    if (!Number.isInteger(finding.line) || finding.line < 1) {
      throw new Error('Codex finding line is invalid');
    }
  }
}

function getStatePaths(workspace, stateDirectoryName) {
  const directory = path.join(workspace, stateDirectoryName);
  return {
    directory,
    disabled: path.join(directory, 'DISABLED'),
    lock: path.join(directory, 'review.lock'),
    needsHuman: path.join(directory, 'NEEDS_HUMAN.md'),
    ready: path.join(directory, 'READY.json'),
    review: path.join(directory, 'REVIEW.json'),
    task: path.join(directory, 'TASK.json'),
  };
}

function getStatus(workspace, stateDirectoryName) {
  const paths = getStatePaths(workspace, stateDirectoryName);
  const task = readJsonIfPresent(paths.task);
  return {
    enabled: !fs.existsSync(paths.disabled),
    ready: fs.existsSync(paths.ready),
    taskId: task?.taskId ?? null,
    cycle: Number.isInteger(task?.reviewCycle) ? task.reviewCycle : 0,
  };
}

function prepare(options, settings) {
  if (!options.taskPath) throw new Error('prepare requires --task <path>');
  const draft = readJsonIfPresent(options.taskPath);
  if (!draft) throw new Error(`Task file not found: ${options.taskPath}`);
  const normalizedDraft = validateTaskDraft(draft);

  const paths = getStatePaths(options.workspace, settings.stateDirectoryName);
  const previous = readJsonIfPresent(paths.task);
  const snapshot = getSnapshot(options.workspace, settings.stateDirectoryName);
  const now = new Date().toISOString();
  const task = {
    ...normalizedDraft,
    schemaVersion: 1,
    workspaceRoot: options.workspace,
    repositoryRoot: snapshot.repositoryRoot,
    baseCommit: snapshot.baseCommit,
    diffHash: snapshot.diffHash,
    changedFiles: snapshot.changedFiles,
    reviewCycle:
      previous?.taskId === normalizedDraft.taskId && Number.isInteger(previous.reviewCycle)
        ? previous.reviewCycle
        : 0,
    updatedAt: now,
  };
  writeJson(paths.task, task);
  writeJson(paths.ready, {
    schemaVersion: 1,
    taskId: task.taskId,
    diffHash: task.diffHash,
    createdAt: now,
  });
}

function acquireLock(lockPath, taskId) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Codex review is already active');
    throw error;
  }
  fs.writeFileSync(
    descriptor,
    `${JSON.stringify({ pid: process.pid, taskId, createdAt: new Date().toISOString() })}\n`,
  );
  fs.closeSync(descriptor);
}

function releaseLock(lockPath) {
  const lock = readJsonIfPresent(lockPath);
  if (lock?.pid === process.pid) fs.rmSync(lockPath, { force: true });
}

function buildReviewPrompt(task, paths) {
  return [
    'Review the current working-tree changes. Do not edit any file.',
    `Read task context from ${paths.task}.`,
    'Read repository AGENTS.md and relevant nested instructions.',
    'Inspect the live Git diff, affected callers, tests, and error paths.',
    'Report only actionable correctness, security, regression, or missing-test findings.',
    'Return output matching the supplied JSON schema.',
    `Task ID: ${task.taskId}`,
    `Expected diff hash: ${task.diffHash}`,
  ].join('\n');
}

function invokeCodex(task, paths, settings, env) {
  const command = env.AGENT_BRIDGE_CODEX_COMMAND || 'codex';
  let prefixArguments = [];
  if (env.AGENT_BRIDGE_CODEX_PREFIX_ARGS) {
    prefixArguments = JSON.parse(env.AGENT_BRIDGE_CODEX_PREFIX_ARGS);
    if (!Array.isArray(prefixArguments) || prefixArguments.some((item) => typeof item !== 'string')) {
      throw new Error('AGENT_BRIDGE_CODEX_PREFIX_ARGS must be a JSON string array');
    }
  }
  const timeout = Number(env.AGENT_BRIDGE_TIMEOUT_MS || 300_000);
  if (!Number.isInteger(timeout) || timeout < 1) throw new Error('AGENT_BRIDGE_TIMEOUT_MS is invalid');
  const outputPath = path.join(paths.directory, `codex-result-${process.pid}.json`);
  const argumentsList = [
    ...prefixArguments,
    'exec',
    '--sandbox',
    'read-only',
    '--output-schema',
    settings.reviewSchemaPath,
    '--output-last-message',
    outputPath,
    buildReviewPrompt(task, paths),
  ];

  try {
    const result = spawnSync(command, argumentsList, {
      cwd: task.repositoryRoot,
      encoding: 'utf8',
      env,
      timeout,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) {
      if (result.error.code === 'ETIMEDOUT') throw new Error(`Codex review timed out after ${timeout}ms`);
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`Codex exited with status ${result.status}: ${String(result.stderr).trim()}`);
    }
    const review = readJsonIfPresent(outputPath);
    if (!review) throw new Error('Codex did not produce a review result');
    validateReview(review);
    return review;
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
}

function writeNeedsHuman(paths, task, summary, cycle, findings = []) {
  const review = {
    schemaVersion: 1,
    taskId: task.taskId,
    diffHash: task.diffHash,
    cycle,
    status: 'needs_human',
    summary,
    findings,
    reviewedAt: new Date().toISOString(),
  };
  writeJson(paths.review, review);
  atomicWrite(
    paths.needsHuman,
    `# Agent Review Needs Human\n\nTask: ${task.taskId}\n\nCycle: ${cycle}\n\n${summary}\n`,
  );
  fs.rmSync(paths.ready, { force: true });
  return review;
}

function processHook(options, settings, io) {
  const paths = getStatePaths(options.workspace, settings.stateDirectoryName);
  const hookInputText = io.readStdin();
  const hookInput = hookInputText.trim() ? JSON.parse(hookInputText) : {};

  if (fs.existsSync(paths.disabled)) return settings.adapter.stop('Codex review automation is disabled.');
  if (!fs.existsSync(paths.ready)) return settings.adapter.stop('No task is marked ready for Codex review.');

  const task = readJsonIfPresent(paths.task);
  const ready = readJsonIfPresent(paths.ready);
  if (!task || !ready) return settings.adapter.stop('Task review state is incomplete.');

  try {
    validateStoredTask(task);
    if (ready.taskId !== task.taskId || ready.diffHash !== task.diffHash) {
      throw new Error('READY.json does not match TASK.json');
    }
    const adapterDecision = settings.adapter.validateHookInput(task, hookInput);
    if (adapterDecision.decision === 'skip') return settings.adapter.stop(adapterDecision.reason);
    acquireLock(paths.lock, task.taskId);
  } catch (error) {
    return settings.adapter.stop(error.message);
  }

  try {
    const before = getSnapshot(options.workspace, settings.stateDirectoryName);
    if (before.repositoryRoot !== path.resolve(task.repositoryRoot) || before.diffHash !== task.diffHash) {
      writeNeedsHuman(paths, task, 'Git diff changed after task preparation; prepare the task again.', task.reviewCycle);
      return settings.adapter.stop('Git diff changed after task preparation. See .agent-bridge/REVIEW.json.');
    }

    const codexReview = invokeCodex(task, paths, settings, io.env);
    const after = getSnapshot(options.workspace, settings.stateDirectoryName);
    if (after.diffHash !== task.diffHash) {
      writeNeedsHuman(paths, task, 'Git diff changed while Codex was reviewing.', task.reviewCycle);
      return settings.adapter.stop('Git diff changed during review. See .agent-bridge/REVIEW.json.');
    }
    if (fs.existsSync(paths.disabled)) {
      writeNeedsHuman(paths, task, 'Review completed after automation was disabled; result was cancelled.', task.reviewCycle);
      return settings.adapter.stop('Automation was disabled while review was running.');
    }

    const cycle = task.reviewCycle + 1;
    task.reviewCycle = cycle;
    task.updatedAt = new Date().toISOString();
    writeJson(paths.task, task);

    if (codexReview.status === 'findings' && cycle >= settings.reviewLimit) {
      writeNeedsHuman(
        paths,
        task,
        `Review limit reached. ${codexReview.summary}`,
        cycle,
        codexReview.findings,
      );
      return settings.adapter.stop('Codex review reached three cycles. See .agent-bridge/NEEDS_HUMAN.md.');
    }

    const review = {
      schemaVersion: 1,
      taskId: task.taskId,
      diffHash: task.diffHash,
      cycle,
      status: codexReview.status,
      summary: codexReview.summary,
      findings: codexReview.findings,
      reviewedAt: new Date().toISOString(),
    };
    writeJson(paths.review, review);

    if (review.status === 'findings') {
      return settings.adapter.continue(
        `Codex review cycle ${cycle} found actionable issues. ` +
          'Read .agent-bridge/REVIEW.json, fix every valid finding, rerun relevant tests, ' +
          'update the task input, then run agent-bridge prepare again.',
      );
    }

    fs.rmSync(paths.ready, { force: true });
    if (review.status === 'needs_human') {
      atomicWrite(
        paths.needsHuman,
        `# Agent Review Needs Human\n\nTask: ${task.taskId}\n\nCycle: ${cycle}\n\n${review.summary}\n`,
      );
      return settings.adapter.stop('Codex requested human review. See .agent-bridge/NEEDS_HUMAN.md.');
    }
    fs.rmSync(paths.needsHuman, { force: true });
    return settings.adapter.stop('Codex review passed.');
  } catch (error) {
    const cycle = Math.min(task.reviewCycle + 1, settings.reviewLimit);
    writeNeedsHuman(paths, task, `Codex review failed: ${error.message}`, cycle);
    return settings.adapter.stop('Codex review failed safely. See .agent-bridge/REVIEW.json.');
  } finally {
    releaseLock(paths.lock);
  }
}

function emit(result, asJson, writeStdout) {
  if (asJson) {
    writeStdout(`${JSON.stringify(result)}\n`);
    return;
  }
  writeStdout(
    `Agent bridge: ${result.enabled ? 'enabled' : 'disabled'}; ` +
      `ready=${result.ready}; task=${result.taskId ?? 'none'}; cycle=${result.cycle}\n`,
  );
}

function createBridgeRuntime(config = {}) {
  const settings = {
    adapter: config.adapter || createAntigravityAdapter(),
    reviewLimit: config.reviewLimit || DEFAULT_REVIEW_LIMIT,
    reviewSchemaPath: config.reviewSchemaPath || DEFAULT_REVIEW_SCHEMA_PATH,
    stateDirectoryName: config.stateDirectoryName || DEFAULT_STATE_DIRECTORY_NAME,
  };

  return {
    parseArguments(argv, env) {
      return parseArguments(argv, env);
    },
    runCli(argv, ioOverrides = {}) {
      const io = {
        env: ioOverrides.env || process.env,
        readStdin: ioOverrides.readStdin || (() => fs.readFileSync(0, 'utf8')),
        writeStdout: ioOverrides.writeStdout || ((text) => process.stdout.write(text)),
        writeStderr: ioOverrides.writeStderr || ((text) => process.stderr.write(text)),
      };
      const options = parseArguments(argv, io.env);
      if (options.adapterName !== settings.adapter.name) {
        throw new Error(
          `Adapter ${options.adapterName} is not available in this entrypoint. Available: ${settings.adapter.name}`,
        );
      }
      const paths = getStatePaths(options.workspace, settings.stateDirectoryName);

      switch (options.command) {
        case 'hook':
          io.writeStdout(`${JSON.stringify(processHook(options, settings, io))}\n`);
          return 0;
        case 'prepare':
          prepare(options, settings);
          break;
        case 'disable':
          if (!fs.existsSync(paths.disabled)) atomicWrite(paths.disabled, `${new Date().toISOString()}\n`);
          break;
        case 'enable':
          fs.rmSync(paths.disabled, { force: true });
          break;
        case 'status':
          break;
        default:
          throw new Error(`Unknown command: ${options.command}`);
      }

      emit(getStatus(options.workspace, settings.stateDirectoryName), options.json, io.writeStdout);
      return 0;
    },
  };
}

function runCli(argv, config) {
  return createBridgeRuntime(config).runCli(argv);
}

function main(argv = process.argv.slice(2)) {
  try {
    process.exitCode = runCli(argv);
  } catch (error) {
    process.stderr.write(`agent-bridge: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ADAPTER_FACTORIES,
  createAntigravityAdapter,
  createBridgeRuntime,
  main,
  runCli,
};

if (require.main === module) {
  main();
}
