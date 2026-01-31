const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const script = process.argv[2];

if (!script) {
  console.error('Usage: node ./scripts/run-medusa.js <script>');
  process.exit(1);
}

const root = process.cwd();
const candidates = [
  path.join(root, '.medusa', 'server', 'node_modules', '@medusajs', 'cli', 'cli.js'),
  path.join(root, 'node_modules', '@medusajs', 'cli', 'cli.js')
];

const cliPath = candidates.find((candidate) => fs.existsSync(candidate));

if (!cliPath) {
  console.error('Medusa CLI not found in .medusa/server or node_modules.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [cliPath, 'exec', script], {
  stdio: 'inherit',
  env: process.env
});

process.exit(result.status ?? 1);
