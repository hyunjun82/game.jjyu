import { getRecentlyUpdated } from '../lib/games';

/**
 * 없는 주소(404).
 * 해외 게임 페이지를 내리면서(2026-09-23) 홈으로 301 보내는 대신 404 를 그대로 둔다.
 * 관련 없는 페이지로 돌리면 구글은 어차피 소프트 404 로 보고, 들어온 사람은 찾던 게임이
 * 왜 없는지 모른 채 홈에 떨어진다. 404 로 두되 지금 쿠폰이 나오는 게임으로 갈 길을 준다.
 */
export const metadata = {
  title: '페이지를 찾을 수 없습니다',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  const games = getRecentlyUpdated(12);
  return (
    <main className="container">
      <section className="block">
        <h1>페이지를 찾을 수 없습니다</h1>
        <p className="empty">
          주소가 바뀌었거나 더 이상 다루지 않는 게임입니다. 이 사이트는 국내 서비스 게임의 쿠폰만 모읍니다.
        </p>
        <a href="/" className="btn btn-back">← 전체 게임 쿠폰 보기</a>
      </section>
      {games.length > 0 && (
        <section className="block">
          <h2 className="block-title">최근 쿠폰이 올라온 게임</h2>
          <div className="chip-row">
            {games.map((g) => (
              <a key={g.slug} href={`/${g.slug}/`} className="chip">
                {g.name}
                <i>{g.active.length}</i>
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
