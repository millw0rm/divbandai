# GitLab integration

Each divband project should get a GitLab project under `git.divband.ir` and CI configured with a project-specific runner tag.

Provisioning must configure:

- Project path.
- Protected branches.
- Container registry.
- CI/CD variables.
- Deploy token or project access token.
- Runner tag, for example `divband-my-project`.
