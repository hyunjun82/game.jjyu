import { getAllGames } from '../../lib/games';

export const dynamic = 'force-static';

const SITE_URL = 'https://game.jjyu.co.kr';

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRfc822(iso) {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

/**
 * 새 쿠폰이 붙은 게임을 최신순으로 내보내는 RSS 2.0 피드.
 * sitemap.xml 은 "URL이 존재한다"만 알리지만, RSS 는 "방금 새로 생겼다"는
 * 신호를 준다 — 네이버·빙 RSS 수집기가 색인을 더 빨리 가져가게 하는 통로다.
 *
 * ⚠️ description 에 쿠폰 코드 값을 넣지 않는다. RSS 는 수집기가 통째로 긁어가는
 * 통로라 여기에 코드가 있으면 사이트 밖에서 답이 보여 클릭할 이유가 사라진다.
 */
export function GET() {
  const games = getAllGames()
    .map((g) => {
      const newest = g.active.reduce(
        (acc, c) => (c.firstSeen && c.firstSeen > acc ? c.firstSeen : acc),
        '',
      );
      return { ...g, newest: newest || g.updatedAt || '' };
    })
    .filter((g) => g.newest && g.active.length > 0);

  games.sort((a, b) => String(b.newest).localeCompare(String(a.newest)));

  const top = games.slice(0, 60);

  const rssItems = top
    .map((g) => {
      const url = `${SITE_URL}/${g.slug}/`;
      const title = `${g.name} 쿠폰 코드 — 사용 가능한 코드 ${g.active.length}개`;
      const desc = `${g.name}에서 지금 쓸 수 있는 쿠폰 코드 ${g.active.length}개가 정리되어 있습니다. 보상과 만료일은 페이지에서 확인.`;
      return `  <item>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(url)}</link>
    <guid isPermaLink="true">${escapeXml(url)}</guid>
    <pubDate>${toRfc822(g.newest)}</pubDate>
    <description>${escapeXml(desc)}</description>
  </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>GAMEDAY — 게임 쿠폰 코드 모음</title>
  <link>${SITE_URL}/</link>
  <description>모바일·PC 게임 쿠폰 코드를 매일 자동으로 모읍니다. 사용 가능한 코드와 보상, 만료일까지 한 번에 확인하세요.</description>
  <language>ko-KR</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${rssItems}
</channel>
</rss>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
