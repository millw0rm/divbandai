# AI-assisted project workflow

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

## Safety controls

### User confirmation before applying generated changes

Patch generation only produces an `AiPatchProposal`. Branch creation fails unless the request body includes `confirmApply: true`, and the backend stamps `confirmedAt` and `confirmedBy` on the patch.

### Merge request review instead of direct production push

The backend creates an `ai/{changeRequestId}` branch and opens a GitLab merge request. The assistant never pushes to the default branch or marks production deploy-ready without the CI gate.

### CI required before deployment

The workflow requires a merge request before CI can be triggered. Deployment readiness is only reported through the status endpoint after CI succeeds and the deploy gate sets `deploymentReady: true`.

### Secrets redaction

The backend redacts token-, secret-, password-, API-key-, and GitLab PAT-looking values in prompts, context summaries, and diffs. Protected environment variable names are surfaced as redacted context metadata; values are not exposed.

### Project-scoped file access

All file paths attached as context or patch files are normalized under the project slug. Empty paths, parent-directory traversal, and `.git` paths are rejected to prevent cross-project access.

## Audit and observability

Each AI transition records an audit action including the change request ID and relevant metadata. Operators can trace request creation, context attachment, patch generation, branch creation, merge request opening, CI triggering, and status updates.
