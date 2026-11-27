// Đọc Obsidian vault (.md + ảnh) -> public/content.json + public/search.json
// Nếu có vault ngoài (vault.config.json) trên máy, tự đồng bộ vào ./vault trước khi build.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import sharp from 'sharp';

const LOCAL_VAULT = path.resolve('./DTT Digital Garden');
const COVERS_DIR = path.resolve('./covers');
const CFG_PATH = path.resolve('./vault.config.json');
const OUT = path.resolve('public');
const IMG_DIR = path.join(OUT, 'img');
const IMG_EXT = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const SKIP_DIRS = new Set(['template', 'templates']);

const slugify = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';

function getExternalVault() {
  if (process.env.VAULT_DIR) return path.resolve(process.env.VAULT_DIR);
  if (fs.existsSync(CFG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    if (cfg.externalVault && fs.existsSync(cfg.externalVault)) return cfg.externalVault;
  }
  return null;
}

// Đồng bộ .md và ảnh từ Obsidian vault thật vào ./vault (để Git/Vercel dùng được)
function syncFromExternal(srcDir) {
  fs.rmSync(LOCAL_VAULT, { recursive: true, force: true });
  fs.mkdirSync(LOCAL_VAULT, { recursive: true });
  (function copyWalk(dir, rel = '') {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory() && SKIP_DIRS.has(e.name.toLowerCase())) continue;
      const src = path.join(dir, e.name);
      const dst = path.join(LOCAL_VAULT, rel, e.name);
      if (e.isDirectory()) copyWalk(src, path.join(rel, e.name));
      else if (/\.md$/i.test(e.name) || IMG_EXT.test(e.name)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }
  })(srcDir);
}

export async function buildContent() {
  const ext = getExternalVault();
  if (ext) syncFromExternal(ext);
  if (!fs.existsSync(LOCAL_VAULT)) {
    console.error('Không thấy vault: ' + LOCAL_VAULT);
    process.exit(1);
  }
  fs.rmSync(IMG_DIR, { recursive: true, force: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });

  const mdFiles = [];
  const images = new Map();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory() && SKIP_DIRS.has(e.name.toLowerCase())) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.md$/i.test(e.name)) mdFiles.push(p);
      else if (IMG_EXT.test(e.name)) images.set(e.name.toLowerCase(), p);
    }
  })(LOCAL_VAULT);
  if (fs.existsSync(COVERS_DIR)) {
    for (const e of fs.readdirSync(COVERS_DIR, { withFileTypes: true })) {
      if (e.isFile() && IMG_EXT.test(e.name)) images.set(e.name.toLowerCase(), path.join(COVERS_DIR, e.name));
    }
  }

  const jobs = new Map();
  const lqips = new Map();
  const copyImage = (name) => {
    const base = path.basename(name).toLowerCase();
    const src = images.get(base);
    if (!src) return null;
    const id = slugify(path.parse(base).name);
    const url = `/img/${id}-1280.webp`;
    jobs.set(url, { src, id });
    return url;
  };

  let notes = [];
  for (const file of mdFiles) {
    const raw = matter(fs.readFileSync(file, 'utf8'));
    const fm = raw.data;
    if (fm.publish === false || fm.draft === true) continue;
    const name = path.parse(file).name;
    const stat = fs.statSync(file);
    notes.push({
      name,
      slug: slugify(fm.slug || name),
      title: fm.title || name,
      tags: [...new Set([].concat(fm.tags || []).filter(Boolean).map((t) => String(t).replace(/^#/, '').replace(/^\/+|\/+$/g, '')))],
      aliases: [].concat(fm.aliases || []).filter(Boolean).map(String),
      date: fm.date ? new Date(fm.date).toISOString() : stat.mtime.toISOString(),
      fmImage: fm.image || fm.cover || null,
      body: raw.content,
    });
  }
  notes.sort((a, b) => new Date(a.date) - new Date(b.date));

  const lookup = new Map();
  for (const n of notes) {
    lookup.set(n.name.toLowerCase(), n);
    n.aliases.forEach((a) => lookup.set(a.toLowerCase(), n));
  }
  const backlinks = new Map(notes.map((n) => [n.slug, new Set()]));

  for (const n of notes) {
    let firstImage = n.fmImage ? copyImage(String(n.fmImage).replace(/^\[\[|\]\]$/g, '')) : null;
    let text = n.body
      .replace(/%%[\s\S]*?%%/g, '')
      .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, f) => {
        const url = copyImage(f.trim());
        if (!url) return '';
        firstImage ||= url;
        return `![${f}](${url})`;
      })
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
        const t = lookup.get(target.trim().toLowerCase());
        if (!t) return label || target;
        backlinks.get(t.slug).add(n.slug);
        return `<a href="/n/${t.slug}" data-slug="${t.slug}">${label || target}</a>`;
      })
      .replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, '$1');
    n.html = marked.parse(text);
    n.image = firstImage;
    n.plain = text.replace(/<[^>]+>/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*_>`~-]/g, ' ').replace(/\s+/g, ' ').trim();
    n.summary = n.plain.slice(0, 140);
  }

  await Promise.all([...jobs].map(async ([url, { src, id }]) => {
    const img = sharp(src);
    await img.clone().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(IMG_DIR, id + '-1280.webp'));
    await img.clone().resize({ width: 320, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(IMG_DIR, id + '-320.webp'));
    const tiny = await img.clone().resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
    lqips.set(url, 'data:image/webp;base64,' + tiny.toString('base64'));
  }));

  const out = notes.map((n, i) => ({
    id: i + 1, slug: n.slug, title: n.title, tags: n.tags, date: n.date,
    summary: n.summary, image: n.image, thumb: n.image && n.image.replace('-1280', '-320'),
    lqip: lqips.get(n.image) || null, html: n.html,
    backlinks: [...backlinks.get(n.slug)],
  }));
  fs.writeFileSync(path.join(OUT, 'content.json'), JSON.stringify({ built: new Date().toISOString(), labels: fs.existsSync('topic-labels.json') ? JSON.parse(fs.readFileSync('topic-labels.json', 'utf8').replace(/^\uFEFF/, '')) : {}, notes: out }));
  fs.writeFileSync(path.join(OUT, 'search.json'), JSON.stringify(notes.map((n, i) => ({
    id: i + 1, title: n.title, tags: n.tags.join(' '), summary: n.summary, body: n.plain,
  }))));
  console.log(`✓ ${out.length} notes` + (ext ? ` (đồng bộ từ ${ext})` : ''));
}

await buildContent();

if (process.argv.includes('--watch')) {
  const watchTarget = getExternalVault() || LOCAL_VAULT;
  let timer;
  console.log(`👀 Đang theo dõi vault: ${watchTarget}`);
  const onWatch = (_, file) => {
    if (!file || file.startsWith('.') || (!/\.md$/i.test(file) && !IMG_EXT.test(file))) return;
    clearTimeout(timer);
    timer = setTimeout(() => buildContent().catch(console.error), 300);
  };
  fs.watch(watchTarget, { recursive: true }, onWatch);
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  fs.watch(COVERS_DIR, onWatch);
}
