#!/usr/bin/env node
/**
 * Compute the next platform bootstrap actions from bootstrap-plan.json and state.
 *
 * Usage:
 *   node infra/orchestration/plan-bootstrap.mjs --state infra/orchestration/state.json
 *   node infra/orchestration/plan-bootstrap.mjs --state infra/orchestration/state.json --probe --json
 */

import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PLAN_PATH = path.join(__dirname, 'bootstrap-plan.json');

const TERMINAL_STATUSES = new Set(['complete', 'skipped']);

function parseArgs(argv) {
  const options = {
    statePath: path.join(__dirname, 'state.json'),
    probe: false,
    json: false,
    repoRoot: REPO_ROOT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--probe') {
      options.probe = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--state') {
      options.statePath = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node infra/orchestration/plan-bootstrap.mjs [options]

Options:
  --state <path>     Bootstrap state file (default: infra/orchestration/state.json)
  --probe            Run readiness probes and auto-mark satisfied phases complete
  --json             Emit machine-readable JSON
  --repo-root <path> Repository root (default: auto-detected)
  --help             Show this help
`);
}

async function fileExists(targetPath) {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadJson(targetPath) {
  const raw = await readFile(targetPath, 'utf8');
  return JSON.parse(raw);
}

function resolvePath(repoRoot, relativePath) {
  return path.isAbsolute(relativePath) ? relativePath : path.join(repoRoot, relativePath);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

async function probeFileExists(repoRoot, probe) {
  const target = resolvePath(repoRoot, probe.path);
  return fileExists(target);
}

async function probeKubectl(repoRoot, probe) {
  const kubeconfig = resolvePath(repoRoot, probe.kubeconfig);
  if (!(await fileExists(kubeconfig))) {
    return false;
  }
  const result = runCommand('kubectl', ['--kubeconfig', kubeconfig, ...probe.args]);
  return result.ok;
}

async function probeTerraformOutput(repoRoot, probe) {
  const cwd = resolvePath(repoRoot, probe.working_dir);
  const result = runCommand('terraform', ['output', '-json', probe.output], { cwd });
  if (!result.ok || !result.stdout) {
    return false;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed != null && (typeof parsed !== 'object' || Object.keys(parsed).length > 0);
  } catch {
    return false;
  }
}

async function probeHttp(state, probe) {
  const url = probe.url ?? state.inventory?.[probe.url_from_inventory];
  if (!url || typeof url !== 'string') {
    return false;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    const allowed = probe.expect_status ?? [200];
    return allowed.includes(response.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function evaluateProbe(repoRoot, state, probe) {
  switch (probe.type) {
    case 'file_exists':
      return probeFileExists(repoRoot, probe);
    case 'kubectl':
      return probeKubectl(repoRoot, probe);
    case 'terraform_output':
      return probeTerraformOutput(repoRoot, probe);
    case 'http':
      return probeHttp(state, probe);
    default:
      return false;
  }
}

function phaseMap(plan) {
  return new Map(plan.phases.map((phase) => [phase.id, phase]));
}

function profileConfig(plan, state) {
  const profileName = state.profile ?? 'vm_ansible';
  const profile = plan.profiles?.[profileName];
  if (!profile) {
    throw new Error(`Unknown profile "${profileName}". Known profiles: ${Object.keys(plan.profiles ?? {}).join(', ')}`);
  }
  return { profileName, profile };
}

function isPhaseActive(phase, profile) {
  if (profile.skip_phases?.includes(phase.id)) {
    return false;
  }
  if (phase.profile && phase.profile !== profile.profileName && !profile.skip_phases?.includes(phase.id)) {
    return false;
  }
  return true;
}

function getPhaseStatus(state, phaseId) {
  return state.phases?.[phaseId]?.status ?? 'pending';
}

function setPhaseStatus(state, phaseId, status) {
  if (!state.phases[phaseId]) {
    state.phases[phaseId] = {};
  }
  state.phases[phaseId].status = status;
}

function dependenciesSatisfied(phase, statuses, profile) {
  const required = (phase.depends_on ?? []).filter((dependencyId) => {
    const dependencyPhase = profile.phaseById.get(dependencyId);
    if (!dependencyPhase) {
      return true;
    }
    return isPhaseActive(dependencyPhase, profile);
  });

  if (phase.depends_on_any?.length) {
    const anyCandidates = phase.depends_on_any.filter((dependencyId) => {
      const dependencyPhase = profile.phaseById.get(dependencyId);
      return dependencyPhase && isPhaseActive(dependencyPhase, profile);
    });
    const anyComplete = anyCandidates.some((dependencyId) => TERMINAL_STATUSES.has(statuses.get(dependencyId) ?? 'pending'));
    const regular = required.filter((dependencyId) => !phase.depends_on_any.includes(dependencyId));
    const regularComplete = regular.every((dependencyId) => TERMINAL_STATUSES.has(statuses.get(dependencyId) ?? 'pending'));
    return anyComplete && regularComplete;
  }

  return required.every((dependencyId) => TERMINAL_STATUSES.has(statuses.get(dependencyId) ?? 'pending'));
}

async function applyProbes(plan, state, repoRoot) {
  const { profileName, profile } = profileConfig(plan, state);
  const byId = phaseMap(plan);
  const enrichedProfile = { ...profile, profileName, phaseById: byId };
  const statuses = buildStatuses(plan, state);

  let changed = true;
  while (changed) {
    changed = false;
    for (const phase of plan.phases) {
      if (!isPhaseActive(phase, enrichedProfile)) {
        statuses.set(phase.id, 'skipped');
        continue;
      }

      const current = statuses.get(phase.id) ?? 'pending';
      if (TERMINAL_STATUSES.has(current)) {
        continue;
      }

      if (!dependenciesSatisfied(phase, statuses, enrichedProfile)) {
        continue;
      }

      if (!phase.probes?.length) {
        continue;
      }

      const probeResults = await Promise.all(phase.probes.map((probe) => evaluateProbe(repoRoot, state, probe)));
      if (probeResults.every(Boolean)) {
        statuses.set(phase.id, 'complete');
        setPhaseStatus(state, phase.id, 'complete');
        changed = true;
      }
    }
  }

  return statuses;
}

function buildStatuses(plan, state) {
  const { profileName, profile } = profileConfig(plan, state);
  const byId = phaseMap(plan);
  const statuses = new Map();

  for (const phase of plan.phases) {
    const active = isPhaseActive(phase, { ...profile, profileName, phaseById: byId });
    if (!active) {
      statuses.set(phase.id, 'skipped');
      if (getPhaseStatus(state, phase.id) === 'pending') {
        setPhaseStatus(state, phase.id, 'skipped');
      }
      continue;
    }
    statuses.set(phase.id, getPhaseStatus(state, phase.id));
  }

  return statuses;
}

function classifyPhases(plan, state, statuses) {
  const { profileName, profile } = profileConfig(plan, state);
  const enrichedProfile = { ...profile, profileName, phaseById: phaseMap(plan) };
  const complete = [];
  const ready = [];
  const blocked = [];
  const pending = [];

  for (const phase of plan.phases) {
    if (!isPhaseActive(phase, enrichedProfile)) {
      continue;
    }

    const status = statuses.get(phase.id) ?? 'pending';
    if (TERMINAL_STATUSES.has(status)) {
      complete.push({ id: phase.id, title: phase.title, status });
      continue;
    }

    if (dependenciesSatisfied(phase, statuses, enrichedProfile)) {
      ready.push(phase);
    } else {
      blocked.push(phase);
    }
    pending.push(phase.id);
  }

  return { complete, ready, blocked, pending };
}

function actionReason(phase) {
  if (phase.owner === 'verify') {
    return 'Verify all prerequisite phases and probes before enabling backend project provisioning.';
  }
  if (phase.owner === 'terraform') {
    return 'Terraform durable resources are missing or state marks this phase pending.';
  }
  if (phase.owner === 'ansible') {
    return 'Ansible VM/cluster bootstrap step has not completed yet.';
  }
  return 'Phase is ready to run.';
}

function formatHuman(result) {
  const lines = [];
  lines.push(`Profile: ${result.profile}`);
  lines.push(`K8s add-ons owner: ${result.k8s_addons_owner}`);
  lines.push('');

  if (result.complete.length > 0) {
    lines.push('Complete:');
    for (const phase of result.complete) {
      lines.push(`  - ${phase.id} (${phase.status})`);
    }
    lines.push('');
  }

  if (result.ready.length === 0 && result.blocked.length === 0) {
    lines.push('Platform bootstrap appears complete.');
    return lines.join('\n');
  }

  if (result.ready.length > 0) {
    lines.push('Ready to run next:');
    for (const action of result.actions) {
      lines.push(`  - [${action.owner}] ${action.phase}: ${action.title}`);
      lines.push(`    reason: ${action.reason}`);
      lines.push(`    command: ${action.command}`);
    }
    lines.push('');
  }

  if (result.blocked.length > 0) {
    lines.push('Blocked (waiting on dependencies):');
    for (const phase of result.blocked) {
      lines.push(`  - ${phase.id}: ${phase.title}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const plan = await loadJson(PLAN_PATH);
  const state = await loadJson(options.statePath);
  const { profileName, profile } = profileConfig(plan, state);

  let statuses;
  if (options.probe) {
    statuses = await applyProbes(plan, state, options.repoRoot);
  } else {
    statuses = buildStatuses(plan, state);
  }

  const { complete, ready, blocked } = classifyPhases(plan, state, statuses);
  const phaseOrder = new Map(plan.phases.map((phase, index) => [phase.id, index]));
  const sortedReady = [...ready].sort((left, right) => (phaseOrder.get(left.id) ?? 0) - (phaseOrder.get(right.id) ?? 0));
  const actions = sortedReady
    .filter((phase) => phase.owner !== 'verify' || ready.every((item) => item.id === 'platform_ready'))
    .map((phase) => ({
      phase: phase.id,
      title: phase.title,
      owner: phase.owner,
      reason: actionReason(phase),
      command: phase.command,
      working_dir: phase.working_dir ?? null,
      optional: Boolean(phase.optional),
    }));

  const platformReady = statuses.get(plan.terminal_phase) === 'complete'
    || complete.some((phase) => phase.id === plan.terminal_phase && phase.status === 'complete');

  const result = {
    profile: profileName,
    k8s_addons_owner: state.k8s_addons_owner ?? profile.k8s_addons_owner,
    platform_ready: platformReady,
    complete,
    ready: sortedReady.map((phase) => ({ id: phase.id, title: phase.title, owner: phase.owner })),
    blocked: blocked.map((phase) => ({ id: phase.id, title: phase.title, owner: phase.owner })),
    actions,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatHuman(result));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
