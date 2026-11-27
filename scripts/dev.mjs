import { spawn } from 'node:child_process';

const a = spawn('node', ['scripts/build-content.mjs', '--watch'], { stdio: 'inherit' });
const b = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });
const stop = () => { a.kill(); b.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
