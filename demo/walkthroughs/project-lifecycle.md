# Demo project lifecycle

This walkthrough reflects the current product flow. On **local dev** (`npm run dev:mvp`), Kubernetes is mocked — steps 3–5 are API placeholders. On **k3s/VPS**, steps 3–5 happen automatically when the project is created.

See [`docs/development-vs-production.md`](../../docs/development-vs-production.md) and [`README.md`](../../README.md#project-auto-provision-on-k3s).

1. Create `sample` in the dashboard (`POST /projects`).
2. **Automatic on k3s:** namespace `project-sample`, nginx welcome page, platform ingress, and hostname `{sample}.{username}.{platformDomain}` are provisioned.
3. Optionally provision `git.divband.ir/demo/sample` or connect GitHub (`POST /projects/{id}/github-repository`).
4. Push `demo/sample-site` through CI — replaces the welcome page in `project-sample`.
5. Add a custom domain with TXT verification (`POST /projects/{id}/domains`).
6. Ask the AI assistant to draft a text change (preview/mock).
7. Review the generated merge request.

Manual retry if auto-provision failed: `POST /projects/{id}/kubernetes-namespace`.
