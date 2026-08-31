import { getAllGames, getRecentlyUpdated, totals } from '../lib/games';
import GameSearch from '../components/GameSearch';

export const metadata = {
  title: '게임 쿠폰 코드 모음 — 오늘 쓸 수 있는 쿠폰 전부',
  description:
    '모바일·PC 게임 쿠폰 코드를 매일 자동으로 모읍니다. 게임별 사용 가능한 코드와 보상, 만료일을 한 번에 확인하세요.',
  alternates: { canonical: '/' },
};

export default function Home() {
  const games = getAllGames();
  const recent = getRecentlyUpdated(6);
  const t = totals();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '게임 쿠폰 코드 모음',
    description: `${t.games}개 게임의 쿠폰 코드 ${t.active}개를 매일 갱신합니다.`,
    inLanguage: 'ko-KR',
    isPartOf: { '@id': 'https://game.jjyu.co.kr/#website' },
  };

  const cards = games.map((g) => ({
    slug: g.slug,
    name: g.name,
    titleEn: g.titleEn,
    image: g.image,
    active: g.active.length,
    total: g.total,
  }));

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="hero">
        <div className="container">
          <h1>
            게임 쿠폰 코드 <em>오늘 쓸 수 있는 것만</em>
          </h1>
          <p className="hero-sub">만료된 코드는 걸러냅니다. 매일 자동으로 갱신됩니다.</p>
          <ul className="stat-inline">
            <li><b>{t.games.toLocaleString()}</b> 게임</li>
            <li><b className="hl">{t.active.toLocaleString()}</b> 사용 가능</li>
            <li><b>{t.all.toLocaleString()}</b> 전체 코드</li>
          </ul>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="container block">
          <h2 className="block-title">지금 쿠폰이 많은 게임</h2>
          <div className="feature-grid">
            {recent.map((g) => (
              <a key={g.slug} href={`/${g.slug}/`} className="feature">
                <span className="feature-img">
                  {g.image ? <img src={g.image} alt="" loading="lazy" decoding="async" /> : <i className="ph" />}
                </span>
                <span className="feature-body">
                  <b>{g.name}</b>
                  <span>사용 가능 {g.active.length}개</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="container block">
        <h2 className="block-title">
          전체 게임 <span className="count">{games.length}</span>
        </h2>
        <GameSearch games={cards} />
      </section>
    </main>
  );
}
