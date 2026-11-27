// Theo dõi ./DTT Digital Garden và ./covers -> sau 30s không đổi sẽ tự commit & push lên GitHub (Vercel tự deploy)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const VAULT = path.resolve('./DTT Digital Garden');
const COVERS = path.resolve('./covers');
fs.mkdirSync(COVERS, { recursive: true });
let timer;
let running = false;

function syncToGit() {
  if (running) return;
  running = true;
  try {
    execSync('git add "DTT Digital Garden" covers', { stdio: 'ignore' });
    const diff = execSync('git status --porcelain "DTT Digital Garden" covers').toString().trim();
    if (diff) {
      execSync('git commit -m "auto: update notes"', { stdio: 'ignore' });
      execSync('git pull --rebase --autostash', { stdio: 'ignore' });
      execSync('git push', { stdio: 'ignore' });
      console.log(`[${new Date().toLocaleTimeString()}] ✓ Đã tự động push note mới lên GitHub`);
    }
  } catch (e) {
    console.error('Lỗi auto-publish:', e.message);
  } finally {
    running = false;
  }
}

syncToGit();
const onChange = (_, file) => {
  if (!file || file.startsWith('.obsidian') || file.includes(`${path.sep}.obsidian`)) return;
  clearTimeout(timer);
  timer = setTimeout(syncToGit, 30_000);
};
fs.watch(VAULT, { recursive: true }, onChange);
fs.watch(COVERS, onChange);
console.log('👀 Auto-publish đang chạy ngầm cho:', VAULT, 'và', COVERS);
