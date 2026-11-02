#!/usr/bin/env node
// Starts the server and restarts it after an update (exit code 42).
// This lets the "Update" button in the app load the new version without any manual step.
const { spawn } = require('child_process');
const path = require('path');

const RESTART_CODE = 42;

let child;
function start() {
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'inherit', env: process.env });
  child.on('exit', code => {
    if (code === RESTART_CODE) {
      console.log('\n  Bijgewerkt. Leerjournaal start opnieuw…\n');
      setTimeout(start, 300);
    } else {
      process.exit(code ?? 0);
    }
  });
}

// Ctrl+C also reaches the server; the launcher waits until it stops cleanly.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => { if (child) child.kill('SIGTERM'); });
start();
