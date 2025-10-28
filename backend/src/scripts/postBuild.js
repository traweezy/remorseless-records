const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const MEDUSA_SERVER_PATH = path.join(process.cwd(), '.medusa', 'server');
const CUSTOM_INIT_SCRIPT = path.join(process.cwd(), 'scripts', 'init-backend.js');
const MEDUSA_INIT_DEST = path.join(MEDUSA_SERVER_PATH, 'scripts', 'init-backend.js');
const MEDUSA_PACKAGE_JSON = path.join(MEDUSA_SERVER_PATH, 'package.json');

// Check if .medusa/server exists - if not, build process failed
if (!fs.existsSync(MEDUSA_SERVER_PATH)) {
  throw new Error('.medusa/server directory not found. This indicates the Medusa build process failed. Please check for build errors.');
}

// Copy pnpm-lock.yaml
const localLockPath = path.join(process.cwd(), 'pnpm-lock.yaml');
const rootLockPath = path.join(process.cwd(), '..', 'pnpm-lock.yaml');
const lockSource = fs.existsSync(localLockPath) ? localLockPath : rootLockPath;

if (!fs.existsSync(lockSource)) {
  throw new Error('pnpm-lock.yaml not found in backend or repository root.');
}

fs.copyFileSync(lockSource, path.join(MEDUSA_SERVER_PATH, 'pnpm-lock.yaml'));

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
      packageJson.scripts.start = 'node ./scripts/init-backend.js && medusa start --verbose';
      fs.writeFileSync(MEDUSA_PACKAGE_JSON, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf-8');
    }
  }
}

// Install dependencies
console.log('Installing dependencies in .medusa/server...');
execSync('pnpm i --prod --frozen-lockfile', { 
  cwd: MEDUSA_SERVER_PATH,
  stdio: 'inherit',
  env: {
    ...process.env,
    CI: process.env.CI ?? 'true'
  }
});
