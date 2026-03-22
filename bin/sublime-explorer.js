#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const appDir = path.resolve(__dirname, '..');
execSync(`npx electron "${appDir}"`, { stdio: 'inherit', cwd: appDir });
