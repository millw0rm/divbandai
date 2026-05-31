const chromePort = Number.parseInt(process.env.CDP_PORT ?? '9222', 10);
const appUrl = process.env.DIVBAND_E2E_APP_URL ?? 'http://localhost:3000';
const demoEmail = process.env.DIVBAND_E2E_DEMO_EMAIL ?? 'demo.owner@divband.test';
const demoPassword = process.env.DIVBAND_E2E_DEMO_PASSWORD ?? 'DemoPass123!';
const waitTimeoutMs = Number.parseInt(process.env.DIVBAND_E2E_TIMEOUT_MS ?? '180000', 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function browserJson(path) {
  const response = await fetch(`http://127.0.0.1:${chromePort}${path}`);
  if (!response.ok) {
    throw new Error(`Chrome debugging endpoint ${path} returned ${response.status}`);
  }
  return response.json();
}

async function getPageTarget() {
  const targets = await browserJson('/json/list');
  const target = targets.find((item) => item.type === 'page') ?? targets[0];
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`No Chrome page target found. Start Chrome with --remote-debugging-port=${chromePort}.`);
  }
  return target;
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
      this.socket.addEventListener('message', (event) => this.onMessage(event));
    });
  }

  onMessage(event) {
    const message = JSON.parse(event.data);
    if (!message.id || !this.pending.has(message.id)) {
      return;
    }
    const { resolve, reject } = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolve(message.result);
    }
  }

  command(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitFor(cdp, label, predicate, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function evalJs(cdp, expression) {
  const result = await cdp.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? 'Runtime evaluation failed.');
  }
  return result.result.value;
}

async function main() {
  const target = await getPageTarget();
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.command('Page.enable');
  await cdp.command('Runtime.enable');

  console.log('Opening local app...');
  await cdp.command('Page.navigate', { url: appUrl });
  await waitFor(cdp, 'app document', () => evalJs(cdp, 'document.readyState === "complete"'));
  await evalJs(cdp, `localStorage.removeItem('divband.dashboard.token'); true`);
  await cdp.command('Page.navigate', { url: appUrl });
  await waitFor(cdp, 'sign-in page', () => evalJs(cdp, 'document.body.textContent.includes("Sign in")'));

  console.log(`Signing in as ${demoEmail}...`);
  await evalJs(cdp, `
    (async () => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: ${JSON.stringify(demoEmail)}, password: ${JSON.stringify(demoPassword)} })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      localStorage.setItem('divband.dashboard.token', body.token);
      location.hash = '#project-list';
      location.reload();
      return true;
    })()
  `);
  await waitFor(cdp, 'project list after demo sign-in', () => evalJs(cdp, `
    Boolean(localStorage.getItem('divband.dashboard.token')) && document.body.textContent.includes('demo-role-test')
  `), 60000);

  console.log('Opening repository status page...');
  await cdp.command('Page.navigate', { url: `${appUrl}/#gitlab-repository-status` });
  await waitFor(cdp, 'repository page', () => evalJs(cdp, 'document.body.textContent.includes("GitHub repository status") || document.body.textContent.includes("GitLab repository status")'));

  const before = await projectState(cdp);
  console.log('Projects before GitHub connect:', JSON.stringify(before, null, 2));

  console.log('Clicking Connect GitHub. Complete GitHub authorization in the browser window.');
  await evalJs(cdp, `
    (() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Connect GitHub');
      if (!button) throw new Error('Connect GitHub button not found');
      button.click();
      return true;
    })()
  `);

  const finalProjects = await waitFor(cdp, 'GitHub callback and repository provisioning', async () => {
    const url = await evalJs(cdp, 'location.href');
    if (!url.startsWith(appUrl)) {
      console.log('Waiting on browser authorization page:', url);
      return undefined;
    }
    const projects = await projectState(cdp);
    const hasRepo = projects.some((project) => project.repositoryUrl);
    if (hasRepo) {
      return projects;
    }
    console.log('Back on local app, waiting for repositoryUrl:', JSON.stringify(projects));
    return undefined;
  }, waitTimeoutMs);

  console.log('Repository provisioning result:', JSON.stringify(finalProjects, null, 2));
  cdp.close();
}

async function projectState(cdp) {
  return evalJs(cdp, `
    (async () => {
      const token = localStorage.getItem('divband.dashboard.token');
      if (!token) return [];
      const response = await fetch('/api/projects', { headers: { authorization: 'Bearer ' + token } });
      const body = await response.json();
      return body.projects.map((project) => ({ id: project.id, slug: project.slug, repositoryUrl: project.repositoryUrl ?? null }));
    })()
  `);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
