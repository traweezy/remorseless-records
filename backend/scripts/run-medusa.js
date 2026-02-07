const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rawScript = process.argv[2];

if (!rawScript) {
  console.error('Usage: node ./scripts/run-medusa.js <script>');
  process.exit(1);
}

const resolveScriptPath = (input) => {
  const root = process.cwd();
  const resolved = path.isAbsolute(input) ? input : path.resolve(root, input);

  if (path.extname(resolved) !== '.ts') {
    return resolved;
  }

  const scriptsRoot = path.resolve(root, 'src', 'scripts');
  if (!resolved.startsWith(`${scriptsRoot}${path.sep}`)) {
    return resolved;
  }

  const relativePath = path.relative(scriptsRoot, resolved).replace(/\.ts$/, '.js');
  const builtCandidate = path.resolve(root, '.medusa', 'server', 'src', 'scripts', relativePath);

  return fs.existsSync(builtCandidate) ? builtCandidate : resolved;
};

const root = process.cwd();
const serverRoot = path.join(root, '.medusa', 'server');
const hasServerRoot = fs.existsSync(serverRoot);
const candidates = [
  path.join(serverRoot, 'node_modules', '@medusajs', 'cli', 'cli.js'),
  path.join(root, 'node_modules', '@medusajs', 'cli', 'cli.js')
];

const cliPath = candidates.find((candidate) => fs.existsSync(candidate));

if (!cliPath) {
  console.error('Medusa CLI not found in .medusa/server or node_modules.');
  process.exit(1);
}

const scriptPath = resolveScriptPath(rawScript);
if (!fs.existsSync(scriptPath)) {
  console.error(`Script not found at ${scriptPath}`);
  process.exit(1);
}

const normalizeForCwd = (targetPath) => {
  if (hasServerRoot && targetPath.startsWith(`${serverRoot}${path.sep}`)) {
    const relativePath = path.relative(serverRoot, targetPath);
    return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
  }
  return targetPath;
};

const result = spawnSync(process.execPath, [cliPath, 'exec', normalizeForCwd(scriptPath)], {
  stdio: 'inherit',
  cwd: hasServerRoot ? serverRoot : root,
  env: process.env
});

process.exit(result.status ?? 1);
