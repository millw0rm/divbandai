# AI-assisted project workflow

The AI assistant helps users draft features safely. It must not directly edit production deployments.

## Flow

1. User describes a change in the dashboard chat.
2. Backend creates an AI change request scoped to one project.
3. Backend gathers safe project context and redacts secrets.
4. AI proposes a plan and patch.
5. User approves creating a GitLab branch.
6. Backend commits the patch to the branch.
7. Backend opens a GitLab merge request.
8. GitLab CI builds and tests the branch.
9. Preview deployment is created when allowed.
10. User reviews, merges, and promotes to production.

## Safety rules

- Keep all generated work inside the target GitLab project.
- Require user confirmation before committing AI-generated changes.
- Prefer merge requests over direct pushes to default branch.
- Do not include secrets, runner tokens, or kubeconfigs in AI context.
- Log AI actions as audit events.
