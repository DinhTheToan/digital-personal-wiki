// Vercel Serverless Function: bình luận cho từng note, lưu trên Upstash Redis (HTTP REST, không cần thêm thư viện).
// Biến môi trường trên Vercel (tự tạo khi bấm Storage -> Create Database -> Upstash Redis):
//   KV_REST_API_URL + KV_REST_API_TOKEN  (hoặc UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
// Dùng chung ADMIN_PASSWORD đã có để admin xóa bình luận.
import crypto from 'node:crypto';

const REDIS_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  const r = await fetch(REDIS_URL(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `Redis ${r.status}`);
  return j.result;
}

const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

const validSlug = (s) => typeof s === 'string' && /^[a-z0-9-]{1,120}$/i.test(s);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!REDIS_URL() || !REDIS_TOKEN()) {
    return res.status(503).json({ error: 'Chưa kết nối Upstash Redis trên Vercel', comments: [] });
  }

  try {
    if (req.method === 'GET') {
      const slug = new URL(req.url, 'http://x').searchParams.get('slug') || '';
      if (!validSlug(slug)) return res.status(400).json({ error: 'slug không hợp lệ', comments: [] });
      const raw = (await redis(['LRANGE', `comments:${slug}`, '0', '199'])) || [];
      const comments = raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
      return res.json({ comments });
    }

    if (req.method === 'POST') {
      const { slug, name, text, website } = req.body || {};
      if (website) return res.status(200).json({ ok: true }); // honeypot chống bot
      if (!validSlug(slug)) return res.status(400).json({ error: 'slug không hợp lệ' });
      const cleanText = String(text || '').trim().slice(0, 1000);
      if (!cleanText) return res.status(400).json({ error: 'Vui lòng nhập nội dung bình luận' });
      const cleanName = String(name || '').trim().slice(0, 50) || 'Ẩn danh';

      // giới hạn 5 bình luận / phút theo IP
      const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
      const count = await redis(['INCR', `rl:cmt:${ip}`]);
      if (count === 1) await redis(['EXPIRE', `rl:cmt:${ip}`, '60']);
      if (count > 5) return res.status(429).json({ error: 'Bạn gửi hơi nhanh, thử lại sau 1 phút nhé' });

      const comment = {
        id: crypto.randomUUID(),
        name: cleanName,
        text: cleanText,
        createdAt: new Date().toISOString(),
      };
      await redis(['RPUSH', `comments:${slug}`, JSON.stringify(comment)]);
      return res.status(201).json({ ok: true, comment });
    }

    if (req.method === 'DELETE') {
      const { slug, id, password } = req.body || {};
      if (!process.env.ADMIN_PASSWORD || !password || !safeEq(password, process.env.ADMIN_PASSWORD)) {
        return res.status(401).json({ error: 'Chỉ admin mới xóa được bình luận' });
      }
      if (!validSlug(slug) || !id) return res.status(400).json({ error: 'thiếu thông tin' });
      const key = `comments:${slug}`;
      const raw = (await redis(['LRANGE', key, '0', '199'])) || [];
      const target = raw.find((s) => { try { return JSON.parse(s).id === id; } catch { return false; } });
      if (target) await redis(['LREM', key, '1', target]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
