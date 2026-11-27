// Vercel Serverless Function: chèn / xóa ảnh bìa cho note ngay từ web online.
// Ghi thẳng vào GitHub bằng 1 commit (ảnh vào /covers + sửa dòng `image:` trong note) -> Vercel tự build lại.
// Biến môi trường (đặt trong Vercel): GITHUB_TOKEN, ADMIN_PASSWORD
// Tùy chọn: GITHUB_REPO (mặc định DinhTheToan/digital-personal-wiki), GITHUB_BRANCH (main), VAULT_PATH ("DTT Digital Garden")
import crypto from 'node:crypto';

const REPO = process.env.GITHUB_REPO || 'DinhTheToan/digital-personal-wiki';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const VAULT = process.env.VAULT_PATH || 'DTT Digital Garden';

const slugify = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';

const gh = async (path, opts = {}) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'digital-wiki-cover',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// ghi/xóa dòng `image:` trong frontmatter, giữ nguyên phần còn lại
function setImage(text, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const line = value ? `image: "${value}"` : null;
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return line ? `---${eol}${line}${eol}---${eol}${eol}${text}` : text;
  let fm = m[1];
  if (/^image:.*$/m.test(fm)) fm = line ? fm.replace(/^image:.*$/m, line) : fm.replace(/^image:.*(\r?\n)?/m, '');
  else if (line) fm = fm + eol + line;
  return text.replace(m[0], () => `---${eol}${fm}${eol}---`);
}

async function findNotePath(slug, tree) {
  const mds = tree.filter((t) => t.type === 'blob' && t.path.startsWith(VAULT + '/') && /\.md$/i.test(t.path)
    && !/\/(template|templates)\//i.test(t.path));
  const byName = mds.find((t) => slugify(t.path.split('/').pop().replace(/\.md$/i, '')) === slug);
  if (byName) return byName.path;
  // note có `slug:` trong frontmatter
  for (const t of mds) {
    const blob = await gh(`/git/blobs/${t.sha}`);
    const txt = Buffer.from(blob.content, 'base64').toString('utf8');
    const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const s = m && m[1].match(/^slug:\s*["']?(.+?)["']?\s*$/m);
    if (s && slugify(s[1]) === slug) return t.path;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!process.env.GITHUB_TOKEN || !process.env.ADMIN_PASSWORD)
    return res.status(500).json({ error: 'Chưa cấu hình GITHUB_TOKEN / ADMIN_PASSWORD trên Vercel' });

  const { password, action = 'check', slug, imageBase64, filename } = req.body || {};
  if (!password || !safeEq(password, process.env.ADMIN_PASSWORD))
    return res.status(401).json({ error: 'Sai mật khẩu' });
  if (action === 'check') return res.json({ ok: true });
  if (!slug) return res.status(400).json({ error: 'thiếu slug' });

  try {
    const ref = await gh(`/git/ref/heads/${BRANCH}`);
    const headSha = ref.object.sha;
    const commit = await gh(`/git/commits/${headSha}`);
    const treeData = await gh(`/git/trees/${commit.tree.sha}?recursive=1`);
    const notePath = await findNotePath(slug, treeData.tree);
    if (!notePath) return res.status(404).json({ error: 'Không tìm thấy note' });

    const noteEntry = treeData.tree.find((t) => t.path === notePath);
    const noteBlob = await gh(`/git/blobs/${noteEntry.sha}`);
    const noteText = Buffer.from(noteBlob.content, 'base64').toString('utf8');

    const items = [];
    let value = null;
    if (action === 'set') {
      if (!imageBase64) return res.status(400).json({ error: 'thiếu ảnh' });
      const ext = (String(filename || '').match(/\.(png|jpe?g|webp|gif|avif)$/i) || ['.jpg'])[0].toLowerCase();
      const name = `${slug}-cover-${Date.now()}${ext}`;
      const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: imageBase64, encoding: 'base64' }) });
      items.push({ path: `covers/${name}`, mode: '100644', type: 'blob', sha: blob.sha });
      value = `/covers/${name}`;
    } else if (action !== 'remove') {
      return res.status(400).json({ error: 'action không hợp lệ' });
    }

    const newText = setImage(noteText, value);
    const noteNew = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: newText, encoding: 'utf-8' }) });
    items.push({ path: notePath, mode: '100644', type: 'blob', sha: noteNew.sha });

    const newTree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: items }) });
    const newCommit = await gh('/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message: `web: ${action === 'set' ? 'đặt' : 'xóa'} ảnh bìa ${slug}`, tree: newTree.sha, parents: [headSha] }),
    });
    await gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha }) });
    return res.json({ ok: true, image: value });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
