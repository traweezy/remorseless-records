const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const MEDUSA_SERVER_PATH = path.join(process.cwd(), '.medusa', 'server');
const CUSTOM_INIT_SCRIPT = path.join(process.cwd(), 'scripts', 'init-backend.js');
const MEDUSA_INIT_DEST = path.join(MEDUSA_SERVER_PATH, 'scripts', 'init-backend.js');
const MEDUSA_PACKAGE_JSON = path.join(MEDUSA_SERVER_PATH, 'package.json');
const MEDUSA_WORKSPACE_YAML = path.join(MEDUSA_SERVER_PATH, 'pnpm-workspace.yaml');
const MEDUSA_PATCHES_DIR = path.join(MEDUSA_SERVER_PATH, 'patches');
const LOCAL_PACKAGE_JSON = path.join(process.cwd(), 'package.json');
const REPOSITORY_ROOT = path.resolve(process.cwd(), '..');
const ROOT_PACKAGE_JSON = path.join(REPOSITORY_ROOT, 'package.json');
const ROOT_WORKSPACE_YAML = path.join(REPOSITORY_ROOT, 'pnpm-workspace.yaml');
const PNPM_CONFIG_CWD = fs.existsSync(ROOT_WORKSPACE_YAML)
  ? REPOSITORY_ROOT
  : process.cwd();
const DEFAULT_ALLOWED_BUILDS = [
  '@medusajs/telemetry',
  '@swc/core',
  'esbuild',
  'lefthook',
  'msgpackr-extract',
  'puppeteer',
  'protobufjs',
  'sharp'
];

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

const readPnpmConfigOverrides = () => {
  try {
    const output = execSync('pnpm config get overrides --json', {
      cwd: PNPM_CONFIG_CWD,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    if (!output || output === 'undefined') {
      return null;
    }

    const overrides = JSON.parse(output);
    return overrides && typeof overrides === 'object' && !Array.isArray(overrides)
      ? overrides
      : null;
  } catch {
    return null;
  }
};

const readPnpmConfigArray = (name) => {
  try {
    const output = execSync(`pnpm config get ${name} --json`, {
      cwd: PNPM_CONFIG_CWD,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    if (!output || output === 'undefined') {
      return [];
    }

    const values = JSON.parse(output);
    return Array.isArray(values)
      ? values.filter((value) => typeof value === 'string' && value.length > 0)
      : [];
  } catch {
    return [];
  }
};

const readPnpmConfigObject = (name) => {
  try {
    const output = execSync(`pnpm config get ${name} --json`, {
      cwd: PNPM_CONFIG_CWD,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    if (!output || output === 'undefined') {
      return null;
    }

    const value = JSON.parse(output);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
};

const readPnpmConfigBoolean = (name, fallback) => {
  try {
    const output = execSync(`pnpm config get ${name} --json`, {
      cwd: PNPM_CONFIG_CWD,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    if (!output || output === 'undefined') {
      return fallback;
    }

    const value = JSON.parse(output);
    return typeof value === 'boolean' ? value : fallback;
  } catch {
    return fallback;
  }
};

const readPnpmPatchedDependencies = () => {
  try {
    const output = execSync('pnpm config get patchedDependencies --json', {
      cwd: PNPM_CONFIG_CWD,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    if (!output || output === 'undefined') {
      return null;
    }

    const patchedDependencies = JSON.parse(output);
    return patchedDependencies &&
      typeof patchedDependencies === 'object' &&
      !Array.isArray(patchedDependencies)
      ? patchedDependencies
      : null;
  } catch {
    return null;
  }
};

const yamlScalar = (value) => JSON.stringify(value);

const appendYamlMapping = (lines, mapping, indent = 0) => {
  const prefix = ' '.repeat(indent);

  for (const [key, value] of Object.entries(mapping)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${prefix}${yamlScalar(key)}:`);
      appendYamlMapping(lines, value, indent + 2);
      continue;
    }

    lines.push(`${prefix}${yamlScalar(key)}: ${yamlScalar(value)}`);
  }
};

const readPnpmAllowBuilds = () => {
  try {
    const output = execSync('pnpm config get allowBuilds --json', {
      cwd: PNPM_CONFIG_CWD,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    if (!output || output === 'undefined') {
      return [];
    }

    const values = JSON.parse(output);
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return [];
    }

    return Object.entries(values)
      .filter(([, approved]) => approved === true)
      .map(([dependency]) => dependency);
  } catch {
    return [];
  }
};

const copyPatchedDependencies = (patchedDependencies) => {
  if (!patchedDependencies || Object.keys(patchedDependencies).length === 0) {
    return null;
  }

  fs.mkdirSync(MEDUSA_PATCHES_DIR, { recursive: true });

  return Object.fromEntries(
    Object.entries(patchedDependencies).map(([dependency, patchPath]) => {
      if (typeof patchPath !== 'string' || patchPath.length === 0) {
        throw new Error(`Invalid patch path for ${dependency}.`);
      }

      const sourcePath = path.isAbsolute(patchPath)
        ? patchPath
        : path.resolve(PNPM_CONFIG_CWD, patchPath);

      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Patch file not found for ${dependency}: ${sourcePath}`);
      }

      const targetFileName = path.basename(sourcePath);
      const targetPath = path.join(MEDUSA_PATCHES_DIR, targetFileName);
      fs.copyFileSync(sourcePath, targetPath);

      return [dependency, `patches/${targetFileName}`];
    })
  );
};

const writePnpmWorkspaceConfig = ({
  allowBuilds,
  hoistPattern,
  minimumReleaseAgeExclude,
  overrides,
  packageExtensions,
  resolvePeersFromWorkspaceRoot,
  patchedDependencies
}) => {
  const lines = [
    'packages:',
    '  - "."'
  ];

  if (hoistPattern.length > 0) {
    lines.push('', 'hoistPattern:');
    for (const pattern of hoistPattern) {
      lines.push(`  - ${yamlScalar(pattern)}`);
    }
  }

  lines.push(
    '',
    `resolvePeersFromWorkspaceRoot: ${yamlScalar(resolvePeersFromWorkspaceRoot)}`
  );

  if (packageExtensions && Object.keys(packageExtensions).length > 0) {
    lines.push('', 'packageExtensions:');
    appendYamlMapping(lines, packageExtensions, 2);
  }

  if (allowBuilds.length > 0) {
    lines.push('', 'allowBuilds:');
    for (const dependency of allowBuilds) {
      lines.push(`  ${yamlScalar(dependency)}: true`);
    }
  }

  if (overrides && Object.keys(overrides).length > 0) {
    lines.push('', 'overrides:');
    for (const [dependency, version] of Object.entries(overrides)) {
      lines.push(`  ${yamlScalar(dependency)}: ${yamlScalar(version)}`);
    }
  }

  if (minimumReleaseAgeExclude.length > 0) {
    lines.push('', 'minimumReleaseAgeExclude:');
    for (const dependency of minimumReleaseAgeExclude) {
      lines.push(`  - ${yamlScalar(dependency)}`);
    }
  }

  if (patchedDependencies && Object.keys(patchedDependencies).length > 0) {
    lines.push('', 'patchedDependencies:');
    for (const [dependency, patchPath] of Object.entries(patchedDependencies)) {
      lines.push(`  ${yamlScalar(dependency)}: ${yamlScalar(patchPath)}`);
    }
  }

  fs.writeFileSync(MEDUSA_WORKSPACE_YAML, `${lines.join('\n')}\n`, 'utf-8');
};

const overrides = readPnpmConfigOverrides() ?? readOverrides(LOCAL_PACKAGE_JSON) ?? readOverrides(ROOT_PACKAGE_JSON);
const allowBuilds = Array.from(new Set([
  ...DEFAULT_ALLOWED_BUILDS,
  ...readPnpmAllowBuilds(),
  ...readPnpmConfigArray('onlyBuiltDependencies')
]));
const minimumReleaseAgeExclude = Array.from(
  new Set(readPnpmConfigArray('minimumReleaseAgeExclude'))
);
const hoistPattern = readPnpmConfigArray('hoistPattern');
const packageExtensions = readPnpmConfigObject('packageExtensions');
const resolvePeersFromWorkspaceRoot = readPnpmConfigBoolean(
  'resolvePeersFromWorkspaceRoot',
  true
);
const patchedDependencies = copyPatchedDependencies(readPnpmPatchedDependencies());

writePnpmWorkspaceConfig({
  allowBuilds,
  hoistPattern,
  minimumReleaseAgeExclude,
  overrides,
  packageExtensions,
  resolvePeersFromWorkspaceRoot,
  patchedDependencies
});

if (fs.existsSync(MEDUSA_PACKAGE_JSON)) {
  const packageJson = JSON.parse(fs.readFileSync(MEDUSA_PACKAGE_JSON, 'utf-8'));
  delete packageJson.pnpm;
  fs.writeFileSync(MEDUSA_PACKAGE_JSON, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf-8');
}

// Install dependencies
console.log('Installing dependencies in .medusa/server...');
execSync('pnpm i --prod --frozen-lockfile --lockfile-dir .', {
  cwd: MEDUSA_SERVER_PATH,
  stdio: 'inherit',
  env: {
    ...process.env,
    CI: process.env.CI ?? 'true'
  }
});
