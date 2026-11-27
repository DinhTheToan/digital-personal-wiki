// Sau `vite build`, tạo bản dist/n/<slug>/index.html có thẻ OpenGraph riêng cho từng note
// giúp gửi link lên Zalo / Facebook / Discord tự hiện ảnh bìa + tiêu đề + tóm tắt.
import fs from 'node:fs';
import path from 'node:path';

const SITE_URL = (process.env.SITE_URL || 'https://digital-personal-wiki.vercel.app').replace(/\/$/, '');
const dist = path.resolve('dist');
const tpl = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const { notes } = JSON.parse(fs.readFileSync(path.resolve('public/content.json'), 'utf8'));
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

for (const n of notes) {
  const title = `${n.title} — DTT Digital Garden`;
  const desc = n.summary || n.title;
  const img = n.image ? `${SITE_URL}${n.image}` : '';
  const og = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${esc(n.title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${SITE_URL}/n/${n.slug}" />`,
    img ? `<meta property="og:image" content="${esc(img)}" />` : '',
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(n.title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    img ? `<meta name="twitter:image" content="${esc(img)}" />` : '',
  ].filter(Boolean).join('\n    ');

  const html = tpl.replace(/<title>[\s\S]*?<\/title>/, og);
  const dir = path.join(dist, 'n', n.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}
console.log(`✓ OG HTML cho ${notes.length} notes`);
