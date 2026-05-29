# GitLab integration

`infra/gitlab` contains GitLab group, project, CI/CD, and runner templates for divband-hosted projects.

Each divband project should get a GitLab project under `git.divband.ir` and CI configured with a project-specific runner tag.

Provisioning must configure:

- User or organization group path.
- Project path and visibility.
- Protected branches and merge-request rules.
- Container registry.
- CI/CD variables scoped to the project and environment.
- Deploy token or project access token with least privilege.
- Runner tag, for example `divband-my-project`.
- Standard CI/CD templates for build, test, image publish, preview deployment, and production deployment.

Jobs with deployment credentials must run only on runners allowed for that project tag.
