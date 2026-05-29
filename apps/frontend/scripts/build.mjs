import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const packageRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(packageRoot, 'src');
const distRoot = path.join(packageRoot, 'dist');
const apiBaseUrl = process.env.DIVBAND_API_BASE_URL ?? process.env.VITE_API_BASE_URL ?? '/api';

function transpile(source, fileName) {
  const result = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      strict: true,
    },
  });

  if (result.diagnostics?.length) {
    const message = ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => packageRoot,
      getNewLine: () => '\n',
    });
    throw new Error(message);
  }

  return result.outputText;
}

await rm(distRoot, { force: true, recursive: true });
await mkdir(path.join(distRoot, 'assets'), { recursive: true });

const dashboardSource = await readFile(path.join(sourceRoot, 'dashboard.ts'), 'utf8');
const mainSource = await readFile(path.join(sourceRoot, 'main.ts'), 'utf8');
const stylesSource = await readFile(path.join(sourceRoot, 'styles.css'), 'utf8');
const indexSource = await readFile(path.join(packageRoot, 'index.html'), 'utf8');

const bundledSource = [
  `const __DIVBAND_API_BASE_URL__ = ${JSON.stringify(apiBaseUrl)};`,
  dashboardSource.replace(/^export\s+(class|function|const)\s+/gm, '$1 '),
  mainSource.replace(/^import\s+[^;]+;\s*$/gm, ''),
].join('\n\n');

const bundle = transpile(bundledSource, 'bundle.ts');
const index = indexSource
  .replace('<script type="module" src="/src/main.ts"></script>', '<script type="module" src="/assets/main.js"></script>')
  .replace('</head>', '    <link rel="stylesheet" href="/assets/styles.css" />\n  </head>');

await writeFile(path.join(distRoot, 'assets', 'main.js'), bundle);
await writeFile(path.join(distRoot, 'assets', 'styles.css'), stylesSource);
await writeFile(path.join(distRoot, 'index.html'), index);

console.log(`Built static frontend in ${path.relative(process.cwd(), distRoot)} with API base URL ${apiBaseUrl}`);
