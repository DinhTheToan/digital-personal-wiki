import { execSync } from 'node:child_process';
import './build-content.mjs';

execSync('git add vault', { stdio: 'inherit' });
const diff = execSync('git status --porcelain vault').toString().trim();
if (!diff) {
  console.log('Không có note mới để đẩy.');
  process.exit(0);
}
execSync('git commit -m "update notes"', { stdio: 'inherit' });
execSync('git push', { stdio: 'inherit' });
