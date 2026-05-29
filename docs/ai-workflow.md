# AI-assisted project workflow

> **Post-MVP preview/mock:** AI-assisted change requests are deferred from the MVP. The current dashboard and API surface may be used to validate workflow shape, but production launch requires real model, repository, GitLab, redaction, audit, rollback, and CI polling adapters before the feature can be treated as a supported product capability.

The AI assistant helps a project member request feature work, review an AI-generated patch, and move the change through GitLab review and CI without giving the model direct production access.

## Goals

- Turn a natural-language feature request into a reviewed GitLab merge request.
- Keep every operation scoped to a single divband project and repository.
- Require an explicit user confirmation before generated code is committed to a branch.
- Require GitLab merge request review and CI success before deployment readiness is reported.
- Redact secrets before any project context is attached to an AI request.

## End-to-end flow

1. **User asks for a feature.** In the dashboard AI chat, the user describes the desired change, such as “add pricing cards to the landing page,” and chooses a target branch.
2. **Backend creates an AI change request.** `POST /projects/{projectId}/ai/change-requests` stores the prompt, redacts secret-like text, records an audit event, and binds the request to the authenticated project.
3. **Backend attaches project context.** `POST /projects/{projectId}/ai/change-requests/{changeRequestId}/context` records a summary and a list of project-scoped files. Parent-directory traversal and `.git` paths are rejected, and protected environment variable names are listed as redacted.
4. **AI proposes changes.** `POST /projects/{projectId}/ai/change-requests/{changeRequestId}/patch` creates a patch proposal with a summary and file-level diffs. The proposal is marked `requiresConfirmation: true` and the workflow moves to `awaiting_confirmation`.
5. **User confirms applying generated changes.** The UI must show the patch summary and require an affirmative confirmation before calling `POST /projects/{projectId}/ai/change-requests/{changeRequestId}/branch` with `confirmApply: true`.
6. **Backend creates a GitLab branch and commit.** The backend writes the confirmed patch to a generated `ai/{changeRequestId}` branch. It does not push directly to `main` or production.
7. **Backend opens a GitLab merge request.** `POST /projects/{projectId}/ai/change-requests/{changeRequestId}/merge-request` opens a merge request from the AI branch into the target branch for human review.
8. **Backend triggers CI.** `POST /projects/{projectId}/ai/change-requests/{changeRequestId}/ci` starts the GitLab pipeline for the merge request branch.
9. **Build/deploy status is reported.** `PUT /projects/{projectId}/ai/change-requests/{changeRequestId}/status` records pipeline state and only marks deployment readiness when CI succeeds and deployment gates pass.
10. **Human reviews, merges, and deploys.** Production deployment proceeds only through the normal merge request and CI-controlled release path.

## Backend API surface

| Capability | Endpoint | Safety gate |
| --- | --- | --- |
| Create an AI change request | `POST /projects/{projectId}/ai/change-requests` | Requires `ai:request_change` and stores a project ID. |
| Attach project context | `POST /projects/{projectId}/ai/change-requests/{changeRequestId}/context` | Redacts secrets and rejects non-project-scoped paths. |
| Generate a patch | `POST /projects/{projectId}/ai/change-requests/{changeRequestId}/patch` | Requires attached context and sets `requiresConfirmation`. |
| Create a GitLab branch | `POST /projects/{projectId}/ai/change-requests/{changeRequestId}/branch` | Requires `confirmApply: true`; branch name is generated. |
| Open a GitLab merge request | `POST /projects/{projectId}/ai/change-requests/{changeRequestId}/merge-request` | Requires an AI branch; review happens in GitLab. |
| Trigger CI | `POST /projects/{projectId}/ai/change-requests/{changeRequestId}/ci` | Requires an open merge request. |
| Report build/deploy status | `PUT /projects/{projectId}/ai/change-requests/{changeRequestId}/status` | Deployment readiness is separate from pipeline state and requires CI success. |

## Frontend workflow

The dashboard AI assistant page should present two layers:

- **Chat input:** a prompt box for the feature request and a target-branch input.
- **Change request controls:** buttons to attach context, generate the patch, confirm branch creation, open the merge request, trigger CI, and inspect status.

The confirmation control must be distinct from the initial prompt submission. Users need to see that generated changes are not applied until they click a confirmation action.

## Safety requirements

These requirements are mandatory before the AI assistant can move from post-MVP preview/mock to a supported production feature.

### User confirmation before applying generated changes

Patch generation only produces an `AiPatchProposal`. Branch creation fails unless the request body includes `confirmApply: true`, and the backend stamps `confirmedAt` and `confirmedBy` on the patch. The UI must show the patch summary, affected files, branch name, target branch, and GitLab commit action before enabling confirmation.

### Secret redaction

The backend redacts token-, secret-, password-, API-key-, and GitLab PAT-looking values in prompts, context summaries, model inputs, model outputs, diffs, logs, and audit metadata. Protected environment variable names are surfaced as redacted context metadata; values are not exposed. Redaction failures must fail closed: no model call, branch creation, or merge request creation should proceed with unredacted context.

### Allowed file paths

All file paths attached as context or patch files are normalized under the project slug. Empty paths, absolute paths, parent-directory traversal, symlink escapes, generated dependency directories, build artifacts, and `.git` paths are rejected to prevent cross-project access. A production implementation must maintain an allowlist of writable project paths and a denylist for secrets, lockfiles unless explicitly confirmed, CI credentials, deployment keys, and platform-owned manifests.

### Branch naming and target branches

The backend creates AI branches with the deterministic prefix `ai/{changeRequestId}` or an equivalent collision-resistant prefix owned by divband. Branch names must be normalized, unique per project, and never user-controlled beyond the target branch selection. Target branches must resolve to allowed repository branches, and the assistant must never push directly to the default branch or production release branches.

### Merge request review instead of direct production push

The backend creates the AI branch and opens a GitLab merge request. The assistant never pushes to the default branch or marks production deploy-ready without the CI gate. Merge request descriptions must identify the AI workflow, list generated files, link to the audit trail, and include rollback notes.

### CI required before deployment

The workflow requires a merge request before CI can be triggered. Deployment readiness is only reported through the status endpoint after CI succeeds and the deploy gate sets `deploymentReady: true`. CI status polling must read GitLab pipeline/job state from the configured adapter rather than trusting client-submitted status for production readiness.

### Rollback

Every AI-generated commit must be traceable to a prior branch SHA and merge request. If branch creation, commit creation, merge request creation, CI, or deployment readiness fails, the workflow must preserve enough metadata to close the merge request, delete or supersede the AI branch, or revert the merge through the normal GitLab rollback path. Rollback actions must be explicit, audited, and visible to the project owner.

### Audit events

Each AI transition records an audit action including the project ID, requester ID, change request ID, previous and next status, redaction result, file count, branch name, commit SHA, merge request IID, pipeline ID, and failure reason when present. Operators can trace request creation, context attachment, patch generation, user confirmation, branch creation, merge request opening, CI triggering, status polling, rollback, and cancellation.

### Failure handling

AI workflow failures must be recoverable and safe by default. Model timeouts, redaction uncertainty, context retrieval misses, invalid diffs, path violations, GitLab adapter errors, merge conflicts, CI failures, and polling timeouts should move the request to a failed or needs-attention state with a user-readable reason. The backend should avoid partial duplicate side effects by using idempotency keys for branch, commit, merge request, and CI operations.

## Audit and observability

The audit log, metrics, and traces should make it clear whether an AI change request is preview/mock or backed by production adapters. Production metrics should include model-call latency/error rate, redaction blocks, path-policy blocks, patch validation failures, GitLab adapter failures, CI polling age, confirmation-to-commit latency, and rollback frequency.
