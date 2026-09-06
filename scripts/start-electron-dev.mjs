import { spawn } from 'node:child_process';
import electronPath from 'electron';
import waitOn from 'wait-on';

const port = process.env.PORT || '3000';
await waitOn({ resources: [`http://localhost:${port}`] });

const electron = spawn(electronPath, ['.'], {
  env: process.env,
  stdio: 'inherit',
  windowsHide: false,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => electron.kill(signal));
}

electron.on('error', (error) => {
  console.error(`[electron:dev] ${error.message}`);
  process.exitCode = 1;
});
electron.on('exit', (code) => process.exit(code ?? 0));
