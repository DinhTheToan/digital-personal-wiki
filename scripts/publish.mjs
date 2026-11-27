import { execSync } from 'node:child_process';
import './build-content.mjs';

execSync('git add "DTT Digital Garden" covers', { stdio: 'inherit' });
const diff = execSync('git status --porcelain "DTT Digital Garden" covers').toString().trim();
if (!diff) {
  console.log('Không có note mới để đẩy.');
  process.exit(0);
}
execSync('git commit -m "update notes"', { stdio: 'inherit' });
execSync('git pull --rebase --autostash', { stdio: 'ignore' });
      execSync('git push', { stdio: 'inherit' });
