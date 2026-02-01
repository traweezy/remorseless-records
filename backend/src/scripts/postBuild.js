const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const MEDUSA_SERVER_PATH = path.join(process.cwd(), '.medusa', 'server');
const CUSTOM_INIT_SCRIPT = path.join(process.cwd(), 'scripts', 'init-backend.js');
const MEDUSA_INIT_DEST = path.join(MEDUSA_SERVER_PATH, 'scripts', 'init-backend.js');
const MEDUSA_PACKAGE_JSON = path.join(MEDUSA_SERVER_PATH, 'package.json');
const LOCAL_PACKAGE_JSON = path.join(process.cwd(), 'package.json');
const ROOT_PACKAGE_JSON = path.join(process.cwd(), '..', 'package.json');

// Check if .medusa/server exists - if not, build process failed
if (!fs.existsSync(MEDUSA_SERVER_PATH)) {
  throw new Error('.medusa/server directory not found. This indicates the Medusa build process failed. Please check for build errors.');
}

// Copy pnpm-lock.yaml (scoped to the backend importer for frozen installs)
const localLockPath = path.join(process.cwd(), 'pnpm-lock.yaml');
const rootLockPath = path.join(process.cwd(), '..', 'pnpm-lock.yaml');
const lockSource = fs.existsSync(localLockPath) ? localLockPath : rootLockPath;

if (!fs.existsSync(lockSource)) {
  throw new Error('pnpm-lock.yaml not found in backend or repository root.');
}

const lockTarget = path.join(MEDUSA_SERVER_PATH, 'pnpm-lock.yaml');
const rawLock = fs.readFileSync(lockSource, 'utf-8');

const rewriteLockfile = (source) => {
  const lines = source.split(/\r?\n/);
  const importersIndex = lines.findIndex((line) => line.trim() === 'importers:');
  if (importersIndex === -1) {
    return source;
  }

  let endIndex = lines.length;
  for (let i = importersIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) {
      continue;
    }
    if (/^[^\s].*:$/.test(line)) {
      endIndex = i;
      break;
    }
  }

  let importerIndent = null;
  for (let i = importersIndex + 1; i < endIndex; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) {
      continue;
    }
    const match = line.match(/^(\s+)\S.*:$/);
    if (match) {
      importerIndent = match[1];
      break;
    }
  }

  if (!importerIndent) {
    return source;
  }

  const blocks = new Map();
  let currentKey = null;
  let blockLines = [];

  for (let i = importersIndex + 1; i < endIndex; i += 1) {
    const line = lines[i];
    const match = line.match(new RegExp(`^${importerIndent.replace(/\\s/g, '\\\\s')}([^\\s].*):$`));
    if (match) {
      if (currentKey) {
        blocks.set(currentKey, blockLines);
      }
      currentKey = match[1].trim();
      blockLines = [line];
      continue;
    }
    if (currentKey) {
      blockLines.push(line);
    }
  }

  if (currentKey) {
    blocks.set(currentKey, blockLines);
  }

  let backendBlock = blocks.get('backend') ?? blocks.get('.');

  if (!backendBlock && blocks.size > 0) {
    let bestKey = null;
    let bestCount = -1;
    for (const [key, value] of blocks.entries()) {
      const specCount = value.filter((entry) => entry.trim().startsWith('specifier:')).length;
      if (specCount > bestCount) {
        bestCount = specCount;
        bestKey = key;
      }
    }
    if (bestKey) {
      backendBlock = blocks.get(bestKey);
    }
  }

  if (!backendBlock) {
    return source;
  }

  const normalizedBlock = backendBlock.slice();
  normalizedBlock[0] = `${importerIndent}.:`;

  const output = [
    ...lines.slice(0, importersIndex + 1),
    '',
    ...normalizedBlock,
    '',
    ...lines.slice(endIndex),
  ];

  return output.join('\n');
};

fs.writeFileSync(lockTarget, rewriteLockfile(rawLock), 'utf-8');

// Copy .env if it exists
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  fs.copyFileSync(
    envPath,
    path.join(MEDUSA_SERVER_PATH, '.env')
  );
}

// Copy custom init script so the built server uses the resilient bootstrapper
if (fs.existsSync(CUSTOM_INIT_SCRIPT)) {
  fs.mkdirSync(path.dirname(MEDUSA_INIT_DEST), { recursive: true });
  fs.copyFileSync(CUSTOM_INIT_SCRIPT, MEDUSA_INIT_DEST);

  if (fs.existsSync(MEDUSA_PACKAGE_JSON)) {
    const packageJson = JSON.parse(fs.readFileSync(MEDUSA_PACKAGE_JSON, 'utf-8'));
    if (packageJson.scripts) {
      packageJson.scripts.ib = 'node ./scripts/init-backend.js';
      packageJson.scripts.start =
        'node ./scripts/init-backend.js && node ./node_modules/@medusajs/cli/cli.js start --verbose';
    }
    fs.writeFileSync(MEDUSA_PACKAGE_JSON, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf-8');
  }
}

const readOverrides = (packagePath) => {
  if (!fs.existsSync(packagePath)) {
    return null;
  }
  const content = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  const overrides = content?.pnpm?.overrides;
  return overrides && typeof overrides === 'object' ? overrides : null;
};

const overrides = readOverrides(LOCAL_PACKAGE_JSON) ?? readOverrides(ROOT_PACKAGE_JSON);

if (overrides && fs.existsSync(MEDUSA_PACKAGE_JSON)) {
  const packageJson = JSON.parse(fs.readFileSync(MEDUSA_PACKAGE_JSON, 'utf-8'));
  packageJson.pnpm = {
    ...(packageJson.pnpm ?? {}),
    overrides
  };
  fs.writeFileSync(MEDUSA_PACKAGE_JSON, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf-8');
}

// Install dependencies
console.log('Installing dependencies in .medusa/server...');
execSync('pnpm i --prod --frozen-lockfile --lockfile-dir . --ignore-workspace', {
  cwd: MEDUSA_SERVER_PATH,
  stdio: 'inherit',
  env: {
    ...process.env,
    CI: process.env.CI ?? 'true'
  }
});
