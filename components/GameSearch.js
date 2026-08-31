'use client';

import { useMemo, useState } from 'react';

/**
 * 게임 목록 + 즉시 검색.
 *
 * 358개를 한 번에 그리면 첫 화면이 무거워진다. 처음엔 48개만 그리고 더 보기로 늘린다.
 * 카드에 그림이 없으면 그냥 글자 나열이 되어버려서, 대표 이미지를 항상 자리로 잡아둔다.
 */
const PAGE = 48;

export default function GameSearch({ games }) {
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return games;
    return games.filter(
      (g) => g.name.toLowerCase().includes(key) || (g.titleEn || '').toLowerCase().includes(key)
    );
  }, [q, games]);

  const list = filtered.slice(0, shown);

  return (
    <>
      <div className="search-wrap">
        <svg className="search-ico" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          className="search"
          placeholder="게임 이름으로 찾기"
          value={q}
          onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
          aria-label="게임 검색"
        />
        {q && <span className="search-count">{filtered.length}</span>}
      </div>

      {list.length === 0 ? (
        <p className="empty">찾는 게임이 없습니다. 다른 이름으로 검색해 보세요.</p>
      ) : (
        <ul className="game-grid">
          {list.map((g) => (
            <li key={g.slug}>
              <a href={`/${g.slug}/`} className="game-card">
                <span className="thumb">
                  {g.image ? <img src={g.image} alt="" loading="lazy" decoding="async" /> : <i className="ph" />}
                  {g.active > 0 && <b className="badge">{g.active}</b>}
                </span>
                <span className="game-name">{g.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {shown < filtered.length && (
        <button type="button" className="btn btn-more" onClick={() => setShown((n) => n + PAGE)}>
          {filtered.length - shown}개 더 보기
        </button>
      )}
    </>
  );
}
