// Đọc Obsidian vault (thư mục .md) -> public/content.json + public/search.json
// Dùng: VAULT_DIR="D:/Obsidian/MyVault" npm run dev   (mặc định: ./vault)
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import sharp from 'sharp';

const VAULT = path.resolve(process.env.VAULT_DIR || './vault');
const OUT = path.resolve('public');
const IMG_DIR = path.join(OUT, 'img');
const IMG_EXT = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

if (!fs.existsSync(VAULT)) {
  console.error('Không thấy vault: ' + VAULT);
  process.exit(1);
}
fs.rmSync(IMG_DIR, { recursive: true, force: true });
fs.mkdirSync(IMG_DIR, { recursive: true });

const slugify = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';

// duyệt vault (bỏ thư mục ẩn như .obsidian)
const mdFiles = [];
const images = new Map(); // basename lower -> full path
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.md$/i.test(e.name)) mdFiles.push(p);
    else if (IMG_EXT.test(e.name)) images.set(e.name.toLowerCase(), p);
  }
})(VAULT);

const jobs = new Map(); // url1280 -> { src, id }
const lqips = new Map(); // url1280 -> data URI
const copyImage = (name) => {
  const base = path.basename(name).toLowerCase();
  const src = images.get(base);
  if (!src) return null;
  const id = slugify(path.parse(base).name);
  const url = `/img/${id}-1280.webp`;
  jobs.set(url, { src, id });
  return url;
};
// pass 1: đọc note
let notes = [];
for (const file of mdFiles) {
  const raw = matter(fs.readFileSync(file, 'utf8'));
  const fm = raw.data;
  if (fm.publish === false || fm.draft === true) continue; // ẩn note: publish: false
  const name = path.parse(file).name;
  const stat = fs.statSync(file);
  notes.push({
    name,
    slug: slugify(fm.slug || name),
    title: fm.title || name,
    tags: [].concat(fm.tags || []).map(String),
    aliases: [].concat(fm.aliases || []).map(String),
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

// pass 2: chuyển wikilink / embed -> markdown -> html
for (const n of notes) {
  let firstImage = n.fmImage ? copyImage(String(n.fmImage).replace(/^\[\[|\]\]$/g, '')) : null;
  let text = n.body
    .replace(/%%[\s\S]*?%%/g, '') // comment Obsidian
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
    .replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, '$1'); // bỏ inline #tag khỏi nội dung
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
  summary: n.summary, image: n.image, thumb: n.image && n.image.replace('-1280','-320'), lqip: lqips.get(n.image) || null, html: n.html,
  backlinks: [...backlinks.get(n.slug)],
}));
fs.writeFileSync(path.join(OUT, 'content.json'),
  JSON.stringify({ built: new Date().toISOString(), notes: out }));
fs.writeFileSync(path.join(OUT, 'search.json'),
  JSON.stringify(notes.map((n, i) => ({
    id: i + 1, title: n.title, tags: n.tags.join(' '), summary: n.summary, body: n.plain,
  }))));
console.log(`✓ ${out.length} notes từ ${VAULT}`);
