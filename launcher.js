#!/usr/bin/env node
// Start de server en start hem opnieuw na een update (exitcode 42).
// Zo kan de knop "Bijwerken" in de app de nieuwe versie laden zonder dat je iets hoeft te doen.
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

// Ctrl+C gaat ook naar de server; de launcher wacht tot die netjes stopt.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => { if (child) child.kill('SIGTERM'); });
start();
