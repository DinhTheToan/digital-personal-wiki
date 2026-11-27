// Đọc Obsidian vault (.md + ảnh) -> public/content.json, search.json, rss.xml, llms.txt, sitemap.xml, n/<slug>.md
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import sharp from 'sharp';
import katex from 'katex';
import hljs from 'highlight.js';

const SITE_URL = (process.env.SITE_URL || 'https://digital-personal-wiki.vercel.app').replace(/\/$/, '');
const LOCAL_VAULT = path.resolve('./DTT Digital Garden');
const COVERS_DIR = path.resolve('./covers');
const OUT = path.resolve('public');
const IMG_DIR = path.join(OUT, 'img');
const MD_OUT = path.join(OUT, 'n');
const IMG_EXT = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const SKIP_DIRS = new Set(['template', 'templates']);

const DEFAULT_QUOTES = [
  { text: '“Chúng ta giờ đây được kết nối bằng Internet, như các nơ-ron trong một bộ não khổng lồ.”', by: 'STEPHEN HAWKING' },
  { text: '“Kiến thức không phải là thứ để cất giữ trong tủ, mà là một khu vườn cần được vun xới mỗi ngày.”', by: 'DIGITAL GARDEN' },
  { text: '“Viết không chỉ để ghi lại điều ta đã biết, mà để khám phá điều ta chưa từng nghĩ tới.”', by: 'FLANNERY O’CONNOR' },
  { text: '“Người đọc sống nghìn cuộc đời trước khi chết. Người không đọc chỉ sống một cuộc đời.”', by: 'GEORGE R.R. MARTIN' },
];

const slugify = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const parseStatus = (v) => {
  if (!v) return null;
  const s = slugify(String(v));
  if (['seed', 'hat-giong', 'seedling'].includes(s)) return 'seed';
  if (['budding', 'dang-lon', 'growing'].includes(s)) return 'budding';
  if (['evergreen', 'hoan-thien', 'done'].includes(s)) return 'evergreen';
  return null;
};

const toIso = (v, fallback) => {
  if (!v) return fallback;
  const d = new Date(v);
  return isNaN(d.getTime()) ? fallback : d.toISOString();
};

const renderer = new marked.Renderer();
renderer.code = (code, lang = '') => {
  const cleanLang = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
  if (cleanLang === 'mermaid') return `<div class="mermaid">${esc(code)}</div>\n`;
  if (cleanLang && hljs.getLanguage(cleanLang)) {
    const hi = hljs.highlight(code, { language: cleanLang }).value;
    return `<pre><code class="hljs language-${cleanLang}">${hi}</code></pre>\n`;
  }
  return `<pre><code class="hljs">${esc(code)}</code></pre>\n`;
};
renderer.table = (header, body) => `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>\n`;
marked.setOptions({ renderer, gfm: true, breaks: false });

function parseQuotes(vaultDir) {
  const qPath = path.join(vaultDir, 'Quotes.md');
  if (!fs.existsSync(qPath)) return DEFAULT_QUOTES;
  const lines = fs.readFileSync(qPath, 'utf8').split(/\r?\n/);
  const list = [];
  for (const raw of lines) {
    const line = raw.replace(/^\s*[-*]\s*/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('---')) continue;
    const parts = line.split(/\s+[—–-]{1,2}\s+/);
    const text = parts[0].trim();
    const by = (parts[1] || 'ST').trim().toUpperCase();
    if (text) list.push({ text: text.startsWith('“') || text.startsWith('"') ? text : `“${text}”`, by });
  }
  return list.length ? list : DEFAULT_QUOTES;
}

function renderRichMarkdown(text) {
  // 1. Bảo vệ code blocks và inline code trước khi xử lý LaTeX / footnotes
  const stash = [];
  const hold = (html) => `@@STASH_${stash.push(html) - 1}@@`;
  let s = text
    .replace(/```[\s\S]*?```/g, (m) => hold(m))
    .replace(/`[^`\n]+`/g, (m) => hold(m));

  // 2. Footnotes: tách định nghĩa [^id]: ...
  const fnDefs = new Map();
  s = s.replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, (_, id, body) => {
    fnDefs.set(id.trim(), body.trim());
    return '';
  });
  const fnOrder = [];
  if (fnDefs.size) {
    s = s.replace(/\[\^([^\]]+)\]/g, (m, id) => {
      const k = id.trim();
      if (!fnDefs.has(k)) return m;
      let idx = fnOrder.indexOf(k);
      if (idx === -1) { fnOrder.push(k); idx = fnOrder.length - 1; }
      return hold(`<sup class="fn-ref"><a href="#fn-${esc(k)}" id="fnref-${esc(k)}">[${idx + 1}]</a></sup>`);
    });
  }

  // 3. KaTeX display $$...$$ và inline $...$
  const mathStash = [];
  const holdMath = (html) => `@@MATH_${mathStash.push(html) - 1}@@`;
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) =>
    holdMath(`<div class="math-block">${katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })}</div>`));
  s = s.replace(/(?<!\\)\$([^$\n]+?)\$/g, (_, expr) =>
    holdMath(katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false })));

  // Trả lại code trước khi marked parse
  s = s.replace(/@@STASH_(\d+)@@/g, (_, i) => stash[+i]);
  let html = marked.parse(s);
  html = html.replace(/@@MATH_(\d+)@@/g, (_, i) => mathStash[+i]);

  // 4. Obsidian Callouts: <blockquote><p>[!note] Tiêu đề ...
  const calloutIcons = { note: '📝', tip: '💡', info: 'ℹ️', warning: '⚠️', important: '❗', quote: '💬', example: '📌', question: '❓' };
  html = html.replace(/<blockquote>\s*<p>\[!([a-zA-Z0-9_-]+)\][+-]?\s*([^\n<]*)(?:<br\s*\/?>|\n)?([\s\S]*?)<\/blockquote>/g, (_, rawType, title, rest) => {
    const type = rawType.toLowerCase();
    const icon = calloutIcons[type] || '📌';
    const heading = (title || type.charAt(0).toUpperCase() + type.slice(1)).trim();
    return `<div class="callout callout-${type}"><div class="callout-title">${icon} ${heading}</div><div class="callout-body"><p>${rest}</div></div>`;
  });

  // 5. Append Footnotes list
  if (fnOrder.length) {
    const items = fnOrder.map((k) =>
      `<li id="fn-${esc(k)}">${marked.parseInline(fnDefs.get(k))} <a class="fn-back" href="#fnref-${esc(k)}">↩</a></li>`).join('');
    html += `<section class="footnotes"><div class="meta">CHÚ THÍCH</div><ol>${items}</ol></section>`;
  }
  return html;
}

export async function buildContent() {
  if (!fs.existsSync(LOCAL_VAULT)) {
    console.error('Không thấy vault: ' + LOCAL_VAULT);
    process.exit(1);
  }
  fs.rmSync(IMG_DIR, { recursive: true, force: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.rmSync(MD_OUT, { recursive: true, force: true });
  fs.mkdirSync(MD_OUT, { recursive: true });

  const mdFiles = [];
  const images = new Map();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory() && SKIP_DIRS.has(e.name.toLowerCase())) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.md$/i.test(e.name)) {
        if (dir === LOCAL_VAULT && /^quotes\.md$/i.test(e.name)) continue;
        mdFiles.push(p);
      } else if (IMG_EXT.test(e.name)) images.set(e.name.toLowerCase(), p);
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
    const rawText = fs.readFileSync(file, 'utf8');
    const raw = matter(rawText);
    const fm = raw.data;
    if (fm.publish === false || fm.draft === true) continue;
    const name = path.parse(file).name;
    const stat = fs.statSync(file);
    const mtimeIso = stat.mtime.toISOString();
    const created = toIso(fm['ngày_tạo'] || fm.created || fm.date, mtimeIso);
    const updated = toIso(fm['cập_nhật'] || fm.updated, mtimeIso);
    notes.push({
      name,
      rawText,
      slug: slugify(fm.slug || name),
      title: fm.title || name,
      tags: [...new Set([].concat(fm.tags || []).filter(Boolean).map((t) => String(t).replace(/^#/, '').replace(/^\/+|\/+$/g, '')))],
      aliases: [].concat(fm.aliases || []).filter(Boolean).map(String),
      created,
      updated,
      date: updated,
      status: parseStatus(fm.status || fm['trạng_thái'] || fm.stage),
      moc: Boolean(fm.moc || fm.pin || fm.pinned || /^index$/i.test(name)),
      fmImage: fm.image || fm.cover || null,
      body: raw.content,
    });
  }
  notes.sort((a, b) => new Date(a.created) - new Date(b.created));

  const lookup = new Map();
  for (const n of notes) {
    lookup.set(n.name.toLowerCase(), n);
    n.aliases.forEach((a) => lookup.set(a.toLowerCase(), n));
  }
  const backlinks = new Map(notes.map((n) => [n.slug, new Set()]));
  const outlinks = new Map(notes.map((n) => [n.slug, new Set()]));

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
        if (t.slug !== n.slug) {
          backlinks.get(t.slug).add(n.slug);
          outlinks.get(n.slug).add(t.slug);
        }
        return `<a href="/n/${t.slug}" data-slug="${t.slug}">${label || target}</a>`;
      })
      .replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, '$1');
    n.html = renderRichMarkdown(text);
    n.image = firstImage;
    n.plain = text.replace(/<[^>]+>/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*_>`~$-]/g, ' ').replace(/\s+/g, ' ').trim();
    n.summary = n.plain.slice(0, 140);
    // Xuất bản .md cho AI/đọc thô tại /n/<slug>.md
    fs.writeFileSync(path.join(MD_OUT, `${n.slug}.md`), `# ${n.title}\n\n${n.body.trim()}\n`);
  }

  await Promise.all([...jobs].map(async ([url, { src, id }]) => {
    const img = sharp(src);
    await img.clone().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(IMG_DIR, id + '-1280.webp'));
    await img.clone().resize({ width: 320, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(IMG_DIR, id + '-320.webp'));
    const tiny = await img.clone().resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
    lqips.set(url, 'data:image/webp;base64,' + tiny.toString('base64'));
  }));

  // Activity heatmap (đếm số note tạo/cập nhật theo ngày YYYY-MM-DD)
  const activity = {};
  for (const n of notes) {
    const days = new Set([n.created.slice(0, 10), n.updated.slice(0, 10)]);
    for (const d of days) activity[d] = (activity[d] || 0) + 1;
  }

  const out = notes.map((n, i) => ({
    id: i + 1, slug: n.slug, title: n.title, tags: n.tags, aliases: n.aliases,
    created: n.created, updated: n.updated, date: n.updated,
    status: n.status, moc: n.moc,
    summary: n.summary, image: n.image, thumb: n.image && n.image.replace('-1280', '-320'),
    lqip: lqips.get(n.image) || null, html: n.html,
    links: [...outlinks.get(n.slug)],
    backlinks: [...backlinks.get(n.slug)],
  }));

  const labels = fs.existsSync('topic-labels.json')
    ? JSON.parse(fs.readFileSync('topic-labels.json', 'utf8').replace(/^\uFEFF/, ''))
    : {};
  const quotes = parseQuotes(LOCAL_VAULT);

  fs.writeFileSync(path.join(OUT, 'content.json'),
    JSON.stringify({ built: new Date().toISOString(), labels, quotes, activity, notes: out }));
  fs.writeFileSync(path.join(OUT, 'search.json'), JSON.stringify(notes.map((n, i) => ({
    id: i + 1, title: n.title, aliases: n.aliases.join(' '), tags: n.tags.join(' '), summary: n.summary, body: n.plain,
  }))));

  // RSS Feed (/rss.xml)
  const rssItems = [...out].sort((a, b) => new Date(b.updated) - new Date(a.updated)).map((n) => `
    <item>
      <title>${esc(n.title)}</title>
      <link>${SITE_URL}/n/${n.slug}</link>
      <guid>${SITE_URL}/n/${n.slug}</guid>
      <pubDate>${new Date(n.updated).toUTCString()}</pubDate>
      <description>${esc(n.summary)}</description>
    </item>`).join('');
  fs.writeFileSync(path.join(OUT, 'rss.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>DTT Digital Garden</title>
  <link>${SITE_URL}</link>
  <description>Khu vườn tri thức cá nhân</description>
  ${rssItems}
</channel></rss>`);

  // Sitemap (/sitemap.xml)
  const urls = ['', '/topics', ...out.map((n) => `/n/${n.slug}`)].map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join('\n');
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`);

  // llms.txt
  const llms = [
    '# DTT Digital Garden',
    '',
    '> Khu vườn tri thức cá nhân đồng bộ từ Obsidian.',
    '',
    '## Notes',
    ...out.map((n) => `- [${n.title}](${SITE_URL}/n/${n.slug}.md): ${n.summary}`),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'llms.txt'), llms + '\n');

  console.log(`✓ ${out.length} notes (+ rss.xml, sitemap.xml, llms.txt)`);
}

await buildContent();

if (process.argv.includes('--watch')) {
  let timer;
  console.log(`👀 Đang theo dõi vault: ${LOCAL_VAULT}`);
  const onWatch = (_, file) => {
    if (!file || file.startsWith('.') || (!/\.md$/i.test(file) && !IMG_EXT.test(file))) return;
    clearTimeout(timer);
    timer = setTimeout(() => buildContent().catch(console.error), 300);
  };
  fs.watch(LOCAL_VAULT, { recursive: true }, onWatch);
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  fs.watch(COVERS_DIR, onWatch);
}
