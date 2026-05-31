# End-to-end browser tests

These tests drive the local dashboard through a real browser and are intended for flows that need external user interaction, such as GitHub OAuth.

## GitHub OAuth repository flow

Start the app:

```sh
npm run dev:mvp
```

Start a headful Chrome session with remote debugging:

```sh
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/divband-oauth-chrome --no-first-run --new-window http://localhost:3000
```

Run the test from another terminal:

```sh
npm run e2e:github-oauth
```

The script signs in as the seeded demo owner, opens the repository status page, clicks `Connect GitHub`, and waits while you approve access in the browser. After GitHub redirects back, it polls `/api/projects` and passes when at least one project has a `repositoryUrl`.

Useful overrides:

```sh
CDP_PORT=9223 DIVBAND_E2E_APP_URL=http://localhost:3000 npm run e2e:github-oauth
```
