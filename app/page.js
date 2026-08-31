import { getAllGames, getRecentlyUpdated, totals, formatDate } from '../lib/games';
import GameSearch from '../components/GameSearch';

export const metadata = {
  title: '게임 쿠폰 코드 모음 — 오늘 쓸 수 있는 쿠폰 전부',
  description:
    '모바일·PC 게임 쿠폰 코드를 매일 자동으로 모읍니다. 게임별 사용 가능한 코드와 보상, 만료일을 한 번에 확인하세요.',
  alternates: { canonical: '/' },
};

export default function Home() {
  const games = getAllGames();
  const recent = getRecentlyUpdated(10);
  const t = totals();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '게임 쿠폰 코드 모음',
    description: `${t.games}개 게임의 쿠폰 코드 ${t.active}개를 매일 갱신합니다.`,
    inLanguage: 'ko-KR',
    isPartOf: { '@id': 'https://game.jjyu.co.kr/#website' },
  };

  return (
    <main className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="hero">
        <h1>
          게임 쿠폰 코드<br />
          <em>오늘 쓸 수 있는 것만</em>
        </h1>
        <p className="hero-sub">
          만료된 코드는 걸러내고 지금 되는 것만 위에 올립니다. 매일 자동으로 갱신됩니다.
        </p>
        <div className="stat-row">
          <div className="stat"><b>{t.games.toLocaleString()}</b><span>게임</span></div>
          <div className="stat"><b>{t.active.toLocaleString()}</b><span>사용 가능</span></div>
          <div className="stat"><b>{t.all.toLocaleString()}</b><span>전체 코드</span></div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="block">
          <h2 className="block-title">새로 올라온 쿠폰</h2>
          <div className="chip-row">
            {recent.map((g) => (
              <a key={g.slug} href={`/${g.slug}/`} className="chip">
                {g.name}
                <i>{g.active.length}</i>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <h2 className="block-title">전체 게임 <span className="count">{games.length}</span></h2>
        <GameSearch
          games={games.map((g) => ({
            slug: g.slug,
            name: g.name,
            titleEn: g.titleEn,
            active: g.active.length,
            total: g.total,
            updatedAt: formatDate(g.updatedAt),
          }))}
        />
      </section>
    </main>
  );
}
