import { getAllGames, getGame, formatDate } from '../../../lib/games';
import CouponList from '../../../components/CouponList';

const SITE_URL = 'https://game.jjyu.co.kr';

export function generateStaticParams() {
  return getAllGames().map((g) => ({ slug: g.slug }));
}

/**
 * 코드 노출 페이지.
 *
 * 왜 페이지를 따로 두는가
 *   게임 페이지에 코드를 바로 깔면 사용자가 복사하고 그대로 나간다. 오퍼월·전면광고가
 *   뜰 시간이 없다(실측: 갓깨비 키우기처럼 코드가 1~2개인 게임은 잠금 없이 바로 노출됐다).
 *   확인 버튼으로 페이지를 한 번 넘기면 그 전환에서 노출 기회가 한 번 더 생긴다.
 *
 * 색인은 하지 않는다
 *   검색에 걸려야 하는 건 설명·FAQ·만료 이력이 있는 게임 페이지다. 이 페이지는 코드만
 *   있어서 얇은 문서로 취급될 수 있으므로 noindex 로 두고 canonical 을 게임 페이지로 보낸다.
 */
export function generateMetadata({ params }) {
  const g = getGame(params.slug);
  if (!g) return {};
  return {
    title: `${g.name} 쿠폰 코드 ${g.active.length}개 — 바로 복사`,
    description: `${g.name} 쿠폰 코드 ${g.active.length}개. 복사해서 게임에 입력하세요.`,
    alternates: { canonical: `/${g.slug}/` },
    robots: { index: false, follow: true },
  };
}

export default function CouponPage({ params }) {
  const g = getGame(params.slug);
  if (!g) return null;

  const updated = formatDate(g.updatedAt);

  return (
    <main className="container">
      <nav className="crumb" aria-label="위치">
        <a href="/">홈</a>
        <span>›</span>
        <a href={`/${g.slug}/`}>{g.name}</a>
        <span>›</span>
        <b>쿠폰 코드</b>
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
            지금 쓸 수 있는 코드 <b>{g.active.length}개</b>
            {g.preReg > 0 && <> · 사전예약 보상 {g.preReg}개</>}
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
        <a href={`/${g.slug}/`} className="btn btn-back">← {g.name} 쿠폰 정보로 돌아가기</a>
      </section>

      <section className="block">
        <h2 className="block-title">다른 게임 쿠폰</h2>
        <div className="chip-row">
          {getAllGames()
            .filter((x) => x.slug !== g.slug && x.active.length > 0)
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
