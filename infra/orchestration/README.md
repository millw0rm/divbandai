# Platform bootstrap orchestration

Machine-readable bootstrap phases and a planner CLI for deciding when to run Ansible vs Terraform.

## Quick start

```sh
cp infra/orchestration/state.example.json infra/orchestration/state.json

node infra/orchestration/plan-bootstrap.mjs --state infra/orchestration/state.json --probe
```

## Files

| File | Purpose |
| --- | --- |
| [`bootstrap-plan.json`](./bootstrap-plan.json) | Phase graph, owners, commands, probes |
| [`state.example.json`](./state.example.json) | Example tracked bootstrap state |
| [`plan-bootstrap.mjs`](./plan-bootstrap.mjs) | Computes next actions from plan + state |

Full design and ownership rules: [`docs/infrastructure-orchestration.md`](../docs/infrastructure-orchestration.md).

After `platform_ready`, per-project Kubernetes work is **backend-driven** (auto welcome stack on `POST /projects`) — not part of this bootstrap planner. See [`README.md`](../../README.md#project-auto-provision-on-k3s).

## Profiles

- `vm_ansible` — k3s + Ansible cluster add-ons (default VM path)
- `managed_terraform_k8s` — production Terraform applies shared K8s add-ons instead

Set `"profile"` and `"k8s_addons_owner"` in `state.json` to match your environment.

## Marking progress

After each successful step, update `state.json`:

```json
"k8s_control_plane": { "status": "complete", "completed_at": "2026-05-31T12:00:00Z" }
```

Use `"status": "skipped"` for optional phases you do not need (for example `load_balancer` in a single-node lab).

Do not commit environment-specific `state.json` if it contains sensitive metadata.
