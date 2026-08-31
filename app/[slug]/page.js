import { getAllGames, getGame, formatDate } from '../../lib/games';
import CouponList from '../../components/CouponList';

const SITE_URL = 'https://game.jjyu.co.kr';

export function generateStaticParams() {
  return getAllGames().map((g) => ({ slug: g.slug }));
}

export function generateMetadata({ params }) {
  const g = getGame(params.slug);
  if (!g) return {};
  const month = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long' });
  return {
    title: `${g.name} 쿠폰 코드 — ${month} 사용 가능한 코드 ${g.active.length}개`,
    description: `${g.name} 쿠폰 코드 ${g.active.length}개를 지금 사용할 수 있습니다. 보상과 만료일, 입력 방법까지 한 번에 확인하세요.`,
    alternates: { canonical: `/${g.slug}/` },
    openGraph: {
      title: `${g.name} 쿠폰 코드 모음`,
      description: `사용 가능한 ${g.name} 쿠폰 ${g.active.length}개 · 매일 자동 갱신`,
      type: 'article',
    },
  };
}

export default function GamePage({ params }) {
  const g = getGame(params.slug);
  if (!g) return null;

  const month = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long' });
  const updated = formatDate(g.updatedAt);

  const faq = [
    {
      q: `${g.name} 쿠폰은 어디에 입력하나요?`,
      a: '게임을 켜고 설정 또는 프로필 메뉴에서 쿠폰·코드 입력란을 찾아 붙여넣으면 됩니다. 게임에 따라 공식 홈페이지에서 입력하는 경우도 있습니다.',
    },
    {
      q: '코드를 넣었는데 오류가 납니다.',
      a: '대소문자를 그대로 붙여넣었는지 확인하세요. 이미 사용한 코드이거나 조기 소진된 코드일 수 있고, 계정 지역이 다르면 막히기도 합니다.',
    },
    {
      q: '쿠폰은 얼마나 자주 올라오나요?',
      a: '게임사가 업데이트·생방송·기념일에 맞춰 배포합니다. 이 페이지는 매일 자동으로 확인해 새 코드가 나오면 바로 반영합니다.',
    },
    {
      q: '만료된 코드는 왜 남겨두나요?',
      a: '이미 쓴 코드인지 확인하려는 분들이 있어 아래에 따로 모아둡니다. 사용 가능한 코드와 섞이지 않게 분리해 두었습니다.',
    },
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: `${g.name} 쿠폰 코드 모음 — ${month}`,
        description: `${g.name} 쿠폰 코드 ${g.active.length}개와 보상, 만료일 정리.`,
        inLanguage: 'ko-KR',
        dateModified: g.updatedAt,
        mainEntityOfPage: `${SITE_URL}/${g.slug}/`,
        publisher: { '@id': `${SITE_URL}/#org` },
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '홈', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: `${g.name} 쿠폰`, item: `${SITE_URL}/${g.slug}/` },
        ],
      },
    ],
  };

  return (
    <main className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav className="crumb" aria-label="위치">
        <a href="/">홈</a>
        <span>›</span>
        <b>{g.name}</b>
      </nav>

      <header className="game-head">
        {g.image && (
          <span className="game-head-img">
            <img src={g.image} alt="" loading="eager" decoding="async" />
          </span>
        )}
        <div>
          <h1>{g.name} 쿠폰 코드</h1>
          <p className="game-sub">
            {month} 기준 사용 가능한 코드 <b>{g.active.length}개</b>
            {g.expired.length > 0 && <> · 만료 {g.expired.length}개</>}
          </p>
          {updated && <p className="game-updated">업데이트 {updated}</p>}
        </div>
      </header>

      {g.active.length > 0 ? (
        <section className="block">
          <h2 className="block-title">사용 가능한 쿠폰</h2>
          <CouponList codes={g.active} />
        </section>
      ) : (
        <section className="block">
          <p className="empty">지금 사용할 수 있는 코드가 없습니다. 새 코드가 나오면 바로 올라옵니다.</p>
        </section>
      )}

      <section className="block">
        <h2 className="block-title">쿠폰 입력 방법</h2>
        <ol className="howto">
          <li>{g.name}을(를) 실행합니다.</li>
          <li>설정 · 프로필 · 이벤트 메뉴에서 쿠폰(코드) 입력란을 엽니다.</li>
          <li>위에서 복사한 코드를 붙여넣습니다. 대소문자를 그대로 넣어야 합니다.</li>
          <li>확인을 누르면 보상이 우편함으로 들어옵니다.</li>
        </ol>
      </section>

      <section className="block">
        <h2 className="block-title">자주 묻는 질문</h2>
        <div className="faq">
          {faq.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {g.expired.length > 0 && (
        <section className="block">
          <h2 className="block-title muted">만료된 쿠폰 <span className="count">{g.expired.length}</span></h2>
          <ul className="expired-list">
            {g.expired.slice(0, 40).map((c) => (
              <li key={c.code}>
                <code>{c.code}</code>
                {c.reward ? <span>{c.reward}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="block">
        <h2 className="block-title">다른 게임 쿠폰</h2>
        <div className="chip-row">
          {getAllGames()
            .filter((x) => x.slug !== g.slug)
            .slice(0, 12)
            .map((x) => (
              <a key={x.slug} href={`/${x.slug}/`} className="chip">
                {x.name}
                <i>{x.active.length}</i>
              </a>
            ))}
        </div>
      </section>
    </main>
  );
}
