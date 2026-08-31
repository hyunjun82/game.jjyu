'use client';

import { useMemo, useState } from 'react';

/**
 * 게임 목록 + 즉시 검색.
 *
 * 목록이 300개를 넘어가면 스크롤로는 못 찾는다. 검색을 위에 두고,
 * 처음에는 일부만 그려서 첫 화면을 가볍게 유지한다.
 */
const PAGE = 60;

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
        <input
          type="search"
          className="search"
          placeholder="게임 이름으로 찾기"
          value={q}
          onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
          aria-label="게임 검색"
        />
        {q && <span className="search-count">{filtered.length}개</span>}
      </div>

      {list.length === 0 ? (
        <p className="empty">찾는 게임이 없습니다. 다른 이름으로 검색해 보세요.</p>
      ) : (
        <ul className="game-grid">
          {list.map((g) => (
            <li key={g.slug}>
              <a href={`/${g.slug}/`} className="game-card">
                <span className="game-name">{g.name}</span>
                <span className="game-meta">
                  {g.active > 0 ? (
                    <b className="ok">사용 가능 {g.active}</b>
                  ) : (
                    <b className="none">만료됨</b>
                  )}
                  <span className="sep">·</span>
                  전체 {g.total}
                </span>
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
