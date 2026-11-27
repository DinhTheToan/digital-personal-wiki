import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import MiniSearch from 'minisearch';

const CARD_W = 220;
const CARD_H = 275 + 56;
const SPACING = 520; // khoảng cách z giữa các card
const QUOTE = '“Chúng ta giờ đây được kết nối bằng Internet, như các nơ-ron trong một bộ não khổng lồ.”';
const QUOTE_BY = 'STEPHEN HAWKING';

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
  useEffect(() => {
    Promise.all([fetch('/content.json').then((r) => r.json()), fetch('/search.json').then((r) => r.json())]).then(
      ([c, s]) => {
        const ms = new MiniSearch({ fields: ['title', 'tags', 'summary', 'body'], storeFields: ['id'] });
        ms.addAll(s);
        setData(c.notes);
        setMini(ms);
      }
    );
  }, []);
  return { notes: data, mini };
}

let fromRect = null; // rect của card được bấm, dùng cho hiệu ứng morph
const pad3 = (n) => String(n).padStart(3, '0');
const noteFromPath = () => (location.pathname.startsWith('/n/') ? decodeURIComponent(location.pathname.slice(3)) : null);

export default function App() {
  const { notes, mini } = useStore();
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') || '');
  const [open, setOpen] = useState(noteFromPath);

  // đồng bộ URL
  useEffect(() => {
    if (open) return;
    const u = new URL(location.href);
    query ? u.searchParams.set('q', query) : u.searchParams.delete('q');
    history.replaceState(null, '', u);
  }, [query, open]);
  useEffect(() => {
    const f = () => setOpen(noteFromPath());
    addEventListener('popstate', f);
    return () => removeEventListener('popstate', f);
  }, []);

  const openNote = useCallback((slug, rect) => {
    fromRect = rect || null;
    history.pushState(null, '', '/n/' + slug);
    setOpen(slug);
  }, []);
  const closeNote = useCallback(() => {
    history.pushState(null, '', query ? '/?q=' + encodeURIComponent(query) : '/');
    setOpen(null);
  }, [query]);

  useEffect(() => {
    const f = (e) => {
      if (e.key !== 'Escape') return;
      if (open) closeNote();
      else setQuery('');
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [open, closeNote]);

  const matches = useMemo(() => {
    if (!notes || !mini || !query.trim()) return null;
    const hits = mini.search(query.trim(), { prefix: true, fuzzy: 0.2, boost: { title: 3, tags: 2 } });
    return new Set(hits.map((h) => h.id));
  }, [notes, mini, query]);

  if (!notes) return <div className="loading">…</div>;
  const current = notes.find((n) => n.slug === open);

  return (
    <>
      <Canvas notes={notes} matches={matches} onOpen={openNote} dim={!!current} query={query} />
      <Chrome notes={notes} query={query} setQuery={setQuery} count={matches?.size} />
      {current && <Reader note={current} notes={notes} onClose={closeNote} onOpen={openNote} />}
    </>
  );
}

function Chrome({ notes, query, setQuery, count }) {
  return (
    <>
      <button className="brand" onClick={() => window.dispatchEvent(new Event('cam-reset'))}>
        digital.wiki
      </button>
      <div className="meta tr">NOTES ({pad3(notes.length)})</div>
      <div className="dock">
        <label className="pill">
          <span className="badge">SEARCH</span>
          <input type="search" placeholder="bất cứ điều gì…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="clear" onClick={() => setQuery('')}>
              {count ?? 0} · CLEAR ×
            </button>
          )}
        </label>
      </div>
      {query && <div className="meta br">ESC ĐỂ XÓA</div>}
    </>
  );
}

function Canvas({ notes, matches, onOpen, dim, query }) {
  const viewport = useRef(null);
  const world = useRef(null);
  const cardEls = useRef([]);
  const cam = useRef({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 });
  const live = useRef({ matches, dim });
  live.current = { matches, dim };

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

  useEffect(() => {
    const c = cam.current;
    const vp = viewport.current;
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

    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('pointerdown', onDown);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    vp.addEventListener('click', onClickCap, true);
    addEventListener('cam-reset', reset);

    const frame = () => {
      const { matches: m } = live.current;
      c.x += (c.tx - c.x) * 0.09;
      c.y += (c.ty - c.y) * 0.09;
      c.z += (c.tz - c.z) * 0.09;
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
      removeEventListener('cam-reset', reset);
    };
  }, [notes, base, maxZ]);

  // mobile: lưới 2 cột khi đang tìm
  const [narrow, setNarrow] = useState(innerWidth < 600);
  useEffect(() => {
    const f = () => setNarrow(innerWidth < 600);
    addEventListener('resize', f);
    return () => removeEventListener('resize', f);
  }, []);
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
          <>
            <p>{QUOTE}</p>
            <div className="meta">— {QUOTE_BY}</div>
          </>
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
        <b>{pad3(n.id)}</b>
        <span>{n.title}</span>
      </div>
    </article>
  );
}

function Reader({ note, notes, onClose, onOpen }) {
  const idx = notes.findIndex((n) => n.slug === note.slug);
  const prev = notes[(idx - 1 + notes.length) % notes.length];
  const next = notes[(idx + 1) % notes.length];
  const body = useRef(null);
  const [copied, setCopied] = useState(false);
  const bigRef = useRef(null);
  const first = useRef(true);

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
        <div className="right" ref={body}>
          <div className="meta">
            ({pad3(note.id)}) NOTE · {new Date(note.date).toLocaleDateString('vi-VN')}
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
          {backlinks.length > 0 && (
            <div className="backlinks">
              <div className="meta">LINKED FROM</div>
              {backlinks.map((b) => <a key={b.slug} href={'/n/' + b.slug} onClick={(e) => { e.preventDefault(); onOpen(b.slug); }}>{b.title}</a>)}
            </div>
          )}
          <nav className="prevnext">
            <button onClick={() => onOpen(prev.slug)}>← {prev.title}</button>
            <button onClick={() => onOpen(next.slug)}>{next.title} →</button>
          </nav>
        </div>
      </div>
    </dialog>
  );
}
