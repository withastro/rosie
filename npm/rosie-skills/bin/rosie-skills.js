#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pkgName = `rosie-skills-${process.platform}-${process.arch}`;

let binaryPath;
try {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  binaryPath = path.join(path.dirname(pkgJsonPath), 'bin', 'rosie');
} catch {
  console.error(`rosie-skills: no prebuilt binary for ${process.platform}-${process.arch}.`);
  console.error('Prebuilt platforms: linux-x64, darwin-arm64, freebsd-x64.');
  console.error('To install on other platforms, build from source: https://github.com/matthewp/rosie');
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: 'inherit' });

if (result.error) {
  console.error(`rosie-skills: failed to execute ${binaryPath}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
