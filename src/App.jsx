import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import MiniSearch from 'minisearch';

const CARD_W = 220;
const CARD_H = 275 + 56;
const SPACING = 520; // khoảng cách z giữa các card
const STATUS_META = {
  seed: { icon: '🌱', label: 'Hạt giống' },
  budding: { icon: '🌿', label: 'Đang lớn' },
  evergreen: { icon: '🌳', label: 'Hoàn thiện' },
};

// PRNG có seed để bố cục ổn định mỗi lần tải
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function useStore() {
  const [data, setData] = useState(null);
  const [mini, setMini] = useState(null);
  const [labels, setLabels] = useState({});
  const [quotes, setQuotes] = useState([]);
  const [activity, setActivity] = useState({});
  useEffect(() => {
    Promise.all([fetch('/content.json').then((r) => r.json()), fetch('/search.json').then((r) => r.json())]).then(
      ([c, s]) => {
        const ms = new MiniSearch({ fields: ['title', 'aliases', 'tags', 'summary', 'body'], storeFields: ['id'] });
        ms.addAll(s);
        setData(c.notes);
        setLabels(c.labels || {});
        setQuotes(c.quotes || []);
        setActivity(c.activity || {});
        setMini(ms);
      }
    );
  }, []);
  return { notes: data, mini, labels, quotes, activity };
}

let fromRect = null; // rect của card được bấm, dùng cho hiệu ứng morph
const pad3 = (n) => String(n).padStart(3, '0');
const noteFromPath = () => (location.pathname.startsWith('/n/') ? decodeURIComponent(location.pathname.slice(3)) : null);
// /topics -> {tag:null}; /topics/<tag> -> {tag}; còn lại null
const galleryFromPath = () => {
  if (location.pathname === '/topics' || location.pathname === '/topics/') return { tag: null };
  if (location.pathname.startsWith('/topics/')) return { tag: decodeURIComponent(location.pathname.slice(8)) };
  return null;
};
let backPath = '/'; // nơi quay về khi đóng bài đọc

export default function App() {
  useEffect(initAdmin, []);
  const { notes, mini, labels, quotes, activity } = useStore();
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') || '');
  const [open, setOpen] = useState(noteFromPath);
  const [gallery, setGallery] = useState(galleryFromPath);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#161614' : '#F5F3EE');
  }, [theme]);

  // đồng bộ URL (chỉ khi đang ở canvas)
  useEffect(() => {
    if (open || gallery) return;
    const u = new URL(location.href);
    query ? u.searchParams.set('q', query) : u.searchParams.delete('q');
    history.replaceState(null, '', u);
  }, [query, open, gallery]);
  const syncFromLocation = useCallback(() => {
    setOpen(noteFromPath());
    setGallery(galleryFromPath());
  }, []);
  useEffect(() => {
    addEventListener('popstate', syncFromLocation);
    return () => removeEventListener('popstate', syncFromLocation);
  }, [syncFromLocation]);

  const go = useCallback((path) => {
    history.pushState(null, '', path);
    syncFromLocation();
  }, [syncFromLocation]);

  const openNote = useCallback((slug, rect) => {
    fromRect = rect || null;
    if (!location.pathname.startsWith('/n/')) backPath = location.pathname + location.search;
    history.pushState(null, '', '/n/' + slug);
    setOpen(slug);
  }, []);
  const closeNote = useCallback(() => go(backPath || '/'), [go]);
  const openGallery = useCallback((tag) => go(tag ? '/topics/' + tag.split('/').map(encodeURIComponent).join('/') : '/topics'), [go]);
  const closeGallery = useCallback(() => go(query ? '/?q=' + encodeURIComponent(query) : '/'), [go, query]);

  useEffect(() => {
    const f = (e) => {
      if (e.key !== 'Escape') return;
      if (open) closeNote();
      else if (gallery) gallery.tag ? openGallery(gallery.tag.includes('/') ? gallery.tag.slice(0, gallery.tag.lastIndexOf('/')) : null) : closeGallery();
      else setQuery('');
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [open, gallery, closeNote, openGallery, closeGallery]);

  const matches = useMemo(() => {
    if (!notes || !mini || !query.trim()) return null;
    const hits = mini.search(query.trim(), { prefix: true, fuzzy: 0.2, boost: { title: 3, tags: 2 } });
    return new Set(hits.map((h) => h.id));
  }, [notes, mini, query]);

  const openRandom = useCallback(() => {
    if (!notes?.length) return;
    if (!gallery && innerWidth >= 600) {
      window.dispatchEvent(new Event('cam-random'));
    } else {
      const pool = notes.length > 1 ? notes.filter((n) => n.slug !== open) : notes;
      openNote(pool[Math.floor(Math.random() * pool.length)].slug);
    }
  }, [notes, gallery, open, openNote]);

  if (!notes) return <div className="loading">…</div>;
  const current = notes.find((n) => n.slug === open);

  return (
    <>
      <Canvas notes={notes} matches={matches} onOpen={openNote} dim={!!current} query={query} quotes={quotes} />
      {gallery && <Gallery notes={notes} tag={gallery.tag} onTag={openGallery} onOpen={openNote} labels={labels} activity={activity} />}
      <Chrome
        notes={notes} query={query} setQuery={setQuery} count={matches?.size}
        inGallery={!!gallery}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onRandom={openRandom}
        onTopics={() => (gallery ? closeGallery() : openGallery(null))}
        onHome={() => { if (gallery) closeGallery(); window.dispatchEvent(new Event('cam-reset')); }}
      />
      {current && <Reader note={current} notes={notes} onClose={closeNote} onOpen={openNote} theme={theme} />}
    </>
  );
}

function Chrome({ notes, query, setQuery, count, inGallery, theme, onToggleTheme, onRandom, onTopics, onHome }) {
  return (
    <>
      <button className="brand" onClick={onHome}>
        digital.wiki
      </button>
      <div className="meta tr">
        <button className="icon-btn" onClick={onRandom} title="Bay tới note ngẫu nhiên">🎲</button>
        <button className="icon-btn" onClick={onToggleTheme} title={theme === 'dark' ? 'Chế độ sáng' : 'Chế độ đọc đêm'}>
          {theme === 'dark' ? '☀' : '◐'}
        </button>
        <button className={'topics-btn' + (inGallery ? ' on' : '')} onClick={onTopics}>
          {inGallery ? 'CANVAS ×' : 'TOPICS'}
        </button>
        <span className="notes-count">NOTES ({pad3(notes.length)})</span>
      </div>
      {!inGallery && <div className="dock">
        <label className="pill">
          <span className="badge">SEARCH</span>
          <input type="search" placeholder="bất cứ điều gì…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="clear" onClick={() => setQuery('')}>
              {count ?? 0} · CLEAR ×
            </button>
          )}
        </label>
      </div>}
      {query && !inGallery && <div className="meta br">ESC ĐỂ XÓA</div>}
    </>
  );
}

const prettify = (seg) => {
  const s = seg.replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function Gallery({ notes, tag, onTag, onOpen, labels, activity }) {
  const label = (seg) => labels[seg] || labels[seg.toLowerCase()] || prettify(seg);
  const base = tag || '';

  // thư mục con trực tiếp + note nằm đúng tại tag này (tách note MOC được ghim)
  const { folders, pinned, direct } = useMemo(() => {
    const f = new Map();
    const p = [];
    const d = [];
    for (const n of notes) {
      const seen = new Set();
      for (const t of n.tags.map((x) => x.replace(/^#/, '').replace(/^\/+|\/+$/g, ''))) {
        if (base && t !== base && !t.startsWith(base + '/')) continue;
        const rest = base ? t.slice(base.length + 1) : t;
        if (!rest) {
          if (!seen.has('.')) {
            seen.add('.');
            (n.moc ? p : d).push(n);
          }
          continue;
        }
        const seg = rest.split('/')[0];
        if (seen.has(seg)) continue;
        seen.add(seg);
        if (!f.has(seg)) f.set(seg, []);
        f.get(seg).push(n);
      }
    }
    const sorted = [...f].sort((a, b) => b[1].length - a[1].length || label(a[0]).localeCompare(label(b[0])));
    return { folders: sorted, pinned: p, direct: d };
  }, [notes, base, labels]);

  const crumbs = tag ? tag.split('/') : [];

  return (
    <div className="gallery">
      <div className="gal-inner">
        <div className="crumbs meta">
          <button onClick={() => onTag(null)}>CHỦ ĐỀ</button>
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              <span>/</span>
              <button onClick={() => onTag(crumbs.slice(0, i + 1).join('/'))}>{label(c).toUpperCase()}</button>
            </React.Fragment>
          ))}
        </div>
        <h1 className="gal-title">{tag ? label(crumbs[crumbs.length - 1]) : 'Chủ đề'}</h1>

        {!tag && <Heatmap activity={activity} />}

        {pinned.length > 0 && (
          <div className="moc-section">
            <div className="meta">📌 BẢN ĐỒ TỔNG QUAN (MOC)</div>
            <div className="moc-list">
              {pinned.map((n) => (
                <button key={n.id} className="moc-card" onClick={() => onOpen(n.slug)}>
                  <b>{n.title}</b>
                  <span>{n.summary}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {folders.length === 0 && direct.length === 0 && pinned.length === 0 && (
          <p className="gal-empty">Chưa có chủ đề nào. Thêm <code>tags: lich-su/nhan-vat</code> vào note trong Obsidian.</p>
        )}

        {folders.length > 0 && (
          <div className="topic-grid">
            {folders.map(([seg, ns]) => (
              <button key={seg} className="topic" onClick={() => onTag(base ? base + '/' + seg : seg)}>
                <div className="stack">
                  {ns.slice(0, 3).map((n, i) => (
                    <div
                      key={n.id}
                      className={'mini' + (n.image ? '' : ' plate')}
                      style={{
                        transform: `translate(${i * 14}px, ${i * -8}px) rotate(${(i - 1) * 3}deg)`,
                        zIndex: 3 - i,
                        backgroundImage: n.thumb ? `url(${n.thumb})` : n.lqip ? `url(${n.lqip})` : undefined,
                      }}
                    >
                      {!n.image && <span>{n.title}</span>}
                    </div>
                  ))}
                </div>
                <div className="topic-name">
                  <span>{label(seg)}</span>
                  <b>{pad3(ns.length)}</b>
                </div>
              </button>
            ))}
          </div>
        )}

        {direct.length > 0 && (
          <>
            {folders.length > 0 && <div className="meta gal-sub">NOTES ({pad3(direct.length)})</div>}
            <div className="gal-grid">
              {direct.map((n) => (
                <Card key={n.id} n={n} onOpen={onOpen} flat />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Heatmap({ activity }) {
  const days = useMemo(() => {
    const arr = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 139; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      arr.push({ key, count: activity?.[key] || 0 });
    }
    return arr;
  }, [activity]);
  const total = days.reduce((s, d) => s + d.count, 0);
  const lvl = (n) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3);
  return (
    <div className="heatmap-wrap">
      <div className="heatmap-head meta">
        <span>NHỊP CHĂM VƯỜN · 20 TUẦN QUA</span>
        <span>{total} LƯỢT TẠO / CẬP NHẬT</span>
      </div>
      <div className="heatmap">
        {days.map((d) => (
          <i key={d.key} className={`hm-${lvl(d.count)}`} title={`${d.key}: ${d.count} note`} />
        ))}
      </div>
    </div>
  );
}

function Canvas({ notes, matches, onOpen, dim, query, quotes }) {
  const viewport = useRef(null);
  const world = useRef(null);
  const cardEls = useRef([]);
  const cam = useRef({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 });
  const live = useRef({ matches, dim });
  live.current = { matches, dim };
  const [qIdx, setQIdx] = useState(() => (quotes?.length ? Math.floor(Math.random() * quotes.length) : 0));
  const activeQuote = quotes?.length ? quotes[qIdx % quotes.length] : {
    text: '“Chúng ta giờ đây được kết nối bằng Internet, như các nơ-ron trong một bộ não khổng lồ.”',
    by: 'STEPHEN HAWKING',
  };

  // vị trí gốc (x,y,z) của từng card
  const base = useMemo(() => {
    const r = rng(20260101);
    return notes.map((_, i) => ({
      x: (r() - 0.5) * 1500,
      y: (r() - 0.5) * 760,
      z: -i * SPACING,
    }));
  }, [notes]);
  const pos = useRef([]);
  const maxZ = (notes.length - 1) * SPACING;

  const [narrow, setNarrow] = useState(innerWidth < 600);
  useEffect(() => {
    const f = () => setNarrow(innerWidth < 600);
    addEventListener('resize', f);
    return () => removeEventListener('resize', f);
  }, []);

  useEffect(() => {
    if (narrow) return;
    const c = cam.current;
    const vp = viewport.current;
    if (!vp || !world.current) return;
    let raf, drag = null, moved = 0;

    const onWheel = (e) => {
      e.preventDefault();
      if (live.current.dim) return;
      c.tz = Math.min(Math.max(c.tz + e.deltaY * 1.1, -600), maxZ + 600);
    };
    const onDown = (e) => {
      if (live.current.dim) return;
      drag = { x: e.clientX, y: e.clientY, tx: c.tx, ty: c.ty };
      moved = 0;
      vp.classList.add('grabbing');
    };
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      c.tx = drag.tx - dx * 1.3;
      c.ty = drag.ty - dy * 1.3;
    };
    const onUp = () => {
      drag = null;
      vp.classList.remove('grabbing');
    };
    const onClickCap = (e) => {
      if (moved > 6) e.stopPropagation();
    };
    const reset = () => { c.tx = 0; c.ty = 0; c.tz = 0; };
    let flyTimer;
    const flyRandom = () => {
      if (!notes.length) return;
      const idx = Math.floor(Math.random() * notes.length);
      const b = base[idx];
      c.tx = b.x;
      c.ty = b.y;
      c.tz = -b.z - 120;
      clearTimeout(flyTimer);
      flyTimer = setTimeout(() => onOpen(notes[idx].slug), 620);
    };

    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('pointerdown', onDown);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    vp.addEventListener('click', onClickCap, true);
    addEventListener('cam-reset', reset);
    addEventListener('cam-random', flyRandom);

    const frame = () => {
      const { matches: m } = live.current;
      c.x += (c.tx - c.x) * 0.09;
      c.y += (c.ty - c.y) * 0.09;
      c.z += (c.tz - c.z) * 0.09;
      if (!world.current) return;
      world.current.style.transform = `translate3d(${-c.x}px, ${-c.y}px, ${c.z}px)`;

      // ring layout cho các card khớp
      const hits = m ? notes.map((n, i) => (m.has(n.id) ? i : -1)).filter((i) => i >= 0) : [];
      const rx = Math.min(innerWidth * 0.36, 460), ry = Math.min(innerHeight * 0.3, 270);

      notes.forEach((n, i) => {
        const el = cardEls.current[i];
        if (!el) return;
        let tgt = base[i];
        let isHit = false;
        const h = hits.indexOf(i);
        if (m && h >= 0) {
          isHit = true;
          const a = (h / hits.length) * Math.PI * 2 - Math.PI / 2;
          tgt = { x: c.x + Math.cos(a) * rx, y: c.y + Math.sin(a) * ry, z: -c.z - 80 };
        }
        const p = (pos.current[i] ||= { ...tgt });
        p.x += (tgt.x - p.x) * 0.1;
        p.y += (tgt.y - p.y) * 0.1;
        p.z += (tgt.z - p.z) * 0.1;
        const rel = p.z + c.z; // <0 = xa camera, >0 = sát/sau camera
        let tier = 'near', op = 1, gray = 0;
        if (rel > 650 || rel < -2600) op = 0;
        else if (rel > 350) op = (650 - rel) / 300;
        else if (rel < -1100) { op = Math.max(0, 1 - (-1100 - rel) / 1500) * 0.55; tier = 'far'; gray = 1; }
        else if (rel < -450) { tier = 'mid'; gray = 0.6; op = 0.9; }
        if (m && !isHit) op *= 0.066;
        if (m && isHit) { op = 1; gray = 0; tier = 'near'; }
        el.style.transform = `translate3d(${p.x - CARD_W / 2}px, ${p.y - CARD_H / 2}px, ${p.z}px)`;
        el.style.opacity = op.toFixed(3);
        el.style.filter = gray ? `grayscale(${gray})` : 'none';
        el.style.pointerEvents = op > 0.5 && tier === 'near' ? 'auto' : 'none';
        el.style.visibility = op < 0.005 ? 'hidden' : 'visible';
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      vp.removeEventListener('wheel', onWheel);
      vp.removeEventListener('pointerdown', onDown);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      vp.removeEventListener('click', onClickCap, true);
      clearTimeout(flyTimer);
      removeEventListener('cam-reset', reset);
      removeEventListener('cam-random', flyRandom);
    };
  }, [notes, base, maxZ, narrow, onOpen]);

  // mobile: lưới 2 cột
  if (narrow) {
    const list = matches ? notes.filter((n) => matches.has(n.id)) : notes;
    return (
      <div className="phone">
        <div className="phone-grid">
          {list.map((n) => (
            <Card key={n.id} n={n} onOpen={onOpen} flat />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="viewport" ref={viewport}>
      <div className="hero">
        {query.trim() ? (
          <>
            <h2>{query}</h2>
            <div className="meta">{matches?.size ? `${matches.size} NOTES` : 'CHƯA CÓ GÌ Ở ĐÂY'}</div>
          </>
        ) : (
          <div className="quote-tap" onClick={() => quotes?.length > 1 && setQIdx((i) => (i + 1) % quotes.length)} title="Bấm để đổi câu nói">
            <p>{activeQuote.text}</p>
            <div className="meta">— {activeQuote.by}</div>
          </div>
        )}
      </div>
      <div className="persp">
        <div className="world" ref={world}>
          {notes.map((n, i) => (
            <Card key={n.id} n={n} onOpen={onOpen} elRef={(el) => (cardEls.current[i] = el)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ n, onOpen, elRef, flat }) {
  return (
    <article className={'card' + (flat ? ' flat' : '')} ref={elRef} onClick={(e) => onOpen(n.slug, e.currentTarget.querySelector('.frame').getBoundingClientRect())}>
      <div className={'frame' + (n.image ? '' : ' plate')} style={n.lqip ? { backgroundImage: `url(${n.lqip})` } : undefined}>
        {n.image ? <img src={n.thumb} alt="" draggable="false" onLoad={(e) => e.target.classList.add('on')} ref={(el) => el?.complete && el.classList.add('on')} /> : <span>{n.summary}</span>}
      </div>
      <div className="caption">
        <b>{pad3(n.id)}{n.status && STATUS_META[n.status] ? ' ' + STATUS_META[n.status].icon : ''}</b>
        <span>{n.title}</span>
      </div>
    </article>
  );
}

function Reader({ note, notes, onClose, onOpen, theme }) {
  const idx = notes.findIndex((n) => n.slug === note.slug);
  const prev = notes[(idx - 1 + notes.length) % notes.length];
  const next = notes[(idx + 1) % notes.length];
  const body = useRef(null);
  const [copied, setCopied] = useState(false);
  const [, forceRender] = useState(0);
  const bigRef = useRef(null);
  const first = useRef(true);

  // Lazy-load Mermaid chỉ khi note có sơ đồ ```mermaid
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    const nodes = root.querySelectorAll('.mermaid');
    if (!nodes.length) return;
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'neutral' });
      mermaid.run({ nodes });
    }).catch(() => {});
  }, [note.slug, note.html, theme]);

  // FLIP: ảnh bay từ card trên canvas vào cột trái
  useEffect(() => {
    const el = bigRef.current;
    if (!el || !first.current || !fromRect) { first.current = false; return; }
    first.current = false;
    const a = fromRect, b = el.getBoundingClientRect();
    const s = a.width / b.width;
    el.animate([{ transformOrigin: '0 0', transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${s})`, boxShadow: 'none' }, { transformOrigin: '0 0', transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }, []);
  const closeMorph = () => {
    const el = bigRef.current, a = fromRect;
    if (!el || !a || a.bottom < 0 || a.top > innerHeight) return onClose();
    const b = el.getBoundingClientRect(), s = a.width / b.width;
    el.animate([{ transformOrigin: '0 0', transform: 'none' }, { transformOrigin: '0 0', transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${s})` }], { duration: 450, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }).onfinish = onClose;
  };

  // chặn click wikilink -> điều hướng SPA
  const onBodyClick = (e) => {
    const a = e.target.closest('a[data-slug]');
    if (a) {
      e.preventDefault();
      onOpen(a.dataset.slug);
    }
  };
  useEffect(() => { body.current?.scrollTo(0, 0); }, [note.slug]);
  const backlinks = notes.filter((n) => note.backlinks.includes(n.slug));

  return (
    <dialog open className="reader">
      <div className="frost" onClick={closeMorph} />
      <div className="sheet">
        <button className="close" onClick={closeMorph}>CLOSE ×</button>
        <div className="left">
          <div ref={bigRef} className={'frame big' + (note.image ? '' : ' plate')} style={note.lqip ? { backgroundImage: `url(${note.lqip})` } : undefined}>
            {note.image ? <img src={note.image} alt="" onLoad={(e) => e.target.classList.add('on')} ref={(el) => el?.complete && el.classList.add('on')} /> : <span>{pad3(note.id)}</span>}
          </div>
        </div>
        <CoverTools note={note} onChanged={() => forceRender((x) => x + 1)} />
        <div className="right" ref={body}>
          <div className="meta reader-meta">
            <span>
              ({pad3(note.id)}) TẠO {new Date(note.created || note.date).toLocaleDateString('vi-VN')}
              {note.updated && note.created && note.updated.slice(0, 10) !== note.created.slice(0, 10)
                ? ` · CẬP NHẬT ${new Date(note.updated).toLocaleDateString('vi-VN')}`
                : ''}
            </span>
            {note.status && STATUS_META[note.status] && (
              <span className="status-badge">
                {STATUS_META[note.status].icon} {STATUS_META[note.status].label}
              </span>
            )}
            <button
              className="copy"
              onClick={() => navigator.clipboard.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
          <h1>{note.title}</h1>
          <div className="tags">{note.tags.map((t) => <span key={t}>#{t}</span>)}</div>
          <div className="prose" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: note.html }} />
          <LocalGraph note={note} notes={notes} onOpen={onOpen} />
          {backlinks.length > 0 && (
            <div className="backlinks">
              <div className="meta">LINKED FROM</div>
              {backlinks.map((b) => <a key={b.slug} href={'/n/' + b.slug} onClick={(e) => { e.preventDefault(); onOpen(b.slug); }}>{b.title}</a>)}
            </div>
          )}
          <Comments slug={note.slug} />
          <nav className="prevnext">
            <button onClick={() => onOpen(prev.slug)}>← {prev.title}</button>
            <button onClick={() => onOpen(next.slug)}>{next.title} →</button>
          </nav>
        </div>
      </div>
    </dialog>
  );
}

function LocalGraph({ note, notes, onOpen }) {
  const neighborSlugs = [...new Set([...(note.links || []), ...(note.backlinks || [])])];
  const neighbors = neighborSlugs.map((s) => notes.find((n) => n.slug === s)).filter(Boolean);
  if (!neighbors.length) return null;

  const W = 440, H = 200, cx = W / 2, cy = H / 2, rx = 150, ry = 68;
  return (
    <section className="local-graph">
      <div className="meta">SƠ ĐỒ LIÊN KẾT ({neighbors.length})</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="graph-svg">
        {neighbors.map((nb, i) => {
          const a = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * rx;
          const y = cy + Math.sin(a) * ry;
          return <line key={nb.slug} x1={cx} y1={cy} x2={x} y2={y} className="g-edge" />;
        })}
        <g className="g-node g-center">
          <circle cx={cx} cy={cy} r={8} />
          <text x={cx} y={cy + 22} textAnchor="middle">{note.title.slice(0, 26)}</text>
        </g>
        {neighbors.map((nb, i) => {
          const a = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * rx;
          const y = cy + Math.sin(a) * ry;
          return (
            <g key={nb.slug} className="g-node g-link" onClick={() => onOpen(nb.slug)}>
              <circle cx={x} cy={y} r={6} />
              <text x={x} y={y + (y < cy ? -12 : 18)} textAnchor="middle">{nb.title.slice(0, 24)}</text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

// ---- Admin: chèn ảnh bìa ----
// Local (`npm run dev`): ghi thẳng vào thư mục covers/. Online: gọi /api/cover (cần mật khẩu admin).
const getPw = () => localStorage.getItem('adminPw');

// Vào https://<web>/?admin hoặc bấm nút Admin nhỏ góc dưới trái để đăng nhập, ?logout để thoát
async function promptAdminLogin() {
  const pw = prompt('Mật khẩu admin:');
  if (!pw) return false;
  try {
    const r = await fetch('/api/cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw, action: 'check' }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      localStorage.setItem('adminPw', pw);
      dispatchEvent(new Event('admin-change'));
      return true;
    }
    alert(j.error || 'Sai mật khẩu');
  } catch {
    alert('Không gọi được API /api/cover');
  }
  return false;
}

export function initAdmin() {
  const q = new URLSearchParams(location.search);
  const clean = (k) => { q.delete(k); const u = new URL(location.href); u.search = q.toString(); history.replaceState(null, '', u); };
  if (q.has('logout')) { localStorage.removeItem('adminPw'); dispatchEvent(new Event('admin-change')); clean('logout'); return; }
  if (!q.has('admin')) return;
  clean('admin');
  promptAdminLogin().then((ok) => ok && alert('Đã đăng nhập admin ✓'));
}

// nén ảnh trong trình duyệt (tối đa 1600px) để gửi nhẹ và vượt giới hạn 4.5MB của Vercel
async function compress(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(',')[1]);
    fr.readAsDataURL(blob);
  });
}

function CoverTools({ note, onChanged }) {
  const isDev = import.meta.env.DEV;
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [admin, setAdmin] = useState(!!getPw());
  useEffect(() => {
    const f = () => setAdmin(!!getPw());
    addEventListener('storage', f);
    addEventListener('admin-change', f);
    return () => { removeEventListener('storage', f); removeEventListener('admin-change', f); };
  }, []);

  const online = async (body) => {
    const r = await fetch('/api/cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: getPw(), slug: note.slug, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { localStorage.removeItem('adminPw'); setAdmin(false); }
    if (!r.ok) throw new Error(j.error || 'Lỗi ' + r.status);
  };

  const send = async (file) => {
    if (!file || !/^image\//.test(file.type)) return;
    setBusy(true);
    setMsg('');
    try {
      if (isDev) {
        await fetch('/__api/cover?slug=' + encodeURIComponent(note.slug), {
          method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name) }, body: file,
        });
        setTimeout(() => setBusy(false), 6000);
      } else {
        await online({ action: 'set', imageBase64: await compress(file), filename: 'cover.jpg' });
        const preview = URL.createObjectURL(file);
        note.image = preview;
        note.thumb = preview;
        onChanged?.();
        setMsg('Đã lưu lên GitHub ✓ (Vercel tự build bản vĩnh viễn sau ~45s)');
        setBusy(false);
      }
    } catch (e) {
      setMsg('Lỗi: ' + e.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setMsg('');
    try {
      if (isDev) {
        await fetch('/__api/cover?slug=' + encodeURIComponent(note.slug), { method: 'DELETE' });
        setTimeout(() => setBusy(false), 6000);
      } else {
        await online({ action: 'remove' });
        note.image = null;
        note.thumb = null;
        note.lqip = null;
        onChanged?.();
        setMsg('Đã xóa ✓ (Vercel tự build lại sau ~45s)');
        setBusy(false);
      }
    } catch (e) {
      setMsg('Lỗi: ' + e.message);
      setBusy(false);
    }
  };
  const canEdit = isDev || admin;
  useEffect(() => {
    if (!canEdit) return;
    const over = (e) => e.preventDefault();
    const drop = (e) => { e.preventDefault(); send(e.dataTransfer.files[0]); };
    addEventListener('dragover', over);
    addEventListener('drop', drop);
    return () => { removeEventListener('dragover', over); removeEventListener('drop', drop); };
  });
  if (!canEdit) {
    return (
      <div className="cover-tools">
        <button className="ghost" onClick={promptAdminLogin}>Admin</button>
      </div>
    );
  }
  return (
    <div className="cover-tools">
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => send(e.target.files[0])} />
      <button onClick={() => input.current.click()} disabled={busy}>
        {busy ? 'Đang xử lý…' : note.image ? 'Đổi ảnh bìa' : '+ Thêm ảnh bìa'}
      </button>
      {note.image && !busy && <button onClick={remove}>Xóa ảnh</button>}
      <span>{msg || (!busy && 'hoặc kéo thả ảnh vào đây')}</span>
    </div>
  );
}

function Comments({ slug }) {
  const [list, setList] = useState([]);
  const [name, setName] = useState(() => localStorage.getItem('commentName') || '');
  const [text, setText] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [admin, setAdmin] = useState(!!getPw());

  useEffect(() => {
    const f = () => setAdmin(!!getPw());
    addEventListener('storage', f);
    addEventListener('admin-change', f);
    return () => { removeEventListener('storage', f); removeEventListener('admin-change', f); };
  }, []);

  useEffect(() => {
    let alive = true;
    setErr('');
    fetch('/api/comments?slug=' + encodeURIComponent(slug))
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!alive) return;
        setList(Array.isArray(j.comments) ? j.comments : []);
        if (!ok && j.error) setErr(j.error);
      })
      .catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [slug]);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      if (name.trim()) localStorage.setItem('commentName', name.trim());
      const r = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name, text, website }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Không gửi được bình luận');
      if (j.comment) setList((prev) => [...prev, j.comment]);
      setText('');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async (id) => {
    const r = await fetch('/api/comments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, id, password: getPw() }),
    });
    if (r.ok) setList((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <section className="comments">
      <div className="meta">BÌNH LUẬN ({list.length})</div>
      <form className="cmt-form" onSubmit={submit}>
        <input
          type="text"
          placeholder="Tên của bạn (để trống = Ẩn danh)"
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" style={{ display: 'none' }} />
        <textarea
          rows={3}
          placeholder="Viết bình luận của bạn…"
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
        />
        <div className="cmt-actions">
          <button type="submit" disabled={busy || !text.trim()}>
            {busy ? 'Đang gửi…' : 'Gửi bình luận'}
          </button>
          {err && <span className="cmt-err">{err}</span>}
        </div>
      </form>
      <div className="cmt-list">
        {list.length === 0 && !err && <div className="cmt-empty">Chưa có bình luận nào. Hãy là người đầu tiên!</div>}
        {list.map((c) => (
          <div key={c.id} className="cmt-item">
            <div className="cmt-head">
              <b>{c.name}</b>
              <span>{new Date(c.createdAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span>
              {admin && <button className="cmt-del" onClick={() => del(c.id)}>Xóa</button>}
            </div>
            <p>{c.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}