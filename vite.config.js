import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const VAULT = path.resolve('./DTT Digital Garden');
const COVERS = path.resolve('./covers');
const slugify = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';

function findNote(slug) {
  let found = null;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.md$/i.test(e.name)) {
        const fm = matter(fs.readFileSync(p, 'utf8')).data;
        if (slugify(fm.slug || path.parse(e.name).name) === slug) found = p;
      }
    }
  })(VAULT);
  return found;
}

// ghi/xóa dòng `image:` trong frontmatter, giữ nguyên phần còn lại
function setImage(file, value) {
  let t = fs.readFileSync(file, 'utf8');
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  const line = value ? `image: "/covers/${value}"` : null;
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    if (line) t = `---${eol}${line}${eol}---${eol}${eol}` + t;
  } else {
    let fm = m[1];
    if (/^image:.*$/m.test(fm)) fm = line ? fm.replace(/^image:.*$/m, line) : fm.replace(/^image:.*(\r?\n)?/m, '');
    else if (line) fm = fm + eol + line;
    t = t.replace(m[0], () => `---${eol}${fm}${eol}---`);
  }
  fs.writeFileSync(file, t);
}

// Chỉ chạy khi `npm run dev` trên máy bạn: tải ảnh bìa lên note ngay trên web
const coverApi = {
  name: 'cover-api',
  configureServer(server) {
    server.middlewares.use('/__api/cover', (req, res) => {
      const slug = new URL(req.url, 'http://x').searchParams.get('slug') || '';
      const file = findNote(slug);
      const done = (code, msg) => { res.statusCode = code; res.end(msg); };
      if (!file) return done(404, 'note not found');
      if (req.method === 'DELETE') { setImage(file, null); return done(200, 'ok'); }
      if (req.method !== 'POST') return done(405, 'method');
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { size += c.length; chunks.push(c); if (size > 25e6) req.destroy(); });
      req.on('end', () => {
        const ext = (decodeURIComponent(req.headers['x-filename'] || '').match(/\.(png|jpe?g|webp|gif|avif)$/i) || ['.png'])[0].toLowerCase();
        const name = `${slug}-cover-${Date.now()}${ext}`;
        fs.mkdirSync(COVERS, { recursive: true });
        fs.writeFileSync(path.join(COVERS, name), Buffer.concat(chunks));
        setImage(file, name);
        done(200, name);
      });
    });
  },
};

export default defineConfig({
  server: {
    watch: {
      ignored: ['**/DTT Digital Garden/**', '**/covers/**'],
    },
  },
  plugins: [
    react(),
    coverApi,
    {
      name: 'watch-content',
      configureServer(server) {
        server.watcher.add('public/content.json');
        server.watcher.on('change', (p) => {
          if (p.endsWith('content.json')) server.ws.send({ type: 'full-reload' });
        });
      },
    },
  ],
});
