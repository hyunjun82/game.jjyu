/**
 * 쿠폰 수집 통계.
 *
 * data/games/*.json 을 훑어 날짜별 신규 코드 수, 만료 수, 게임별 현황을
 * data/stats.json 으로 떨어뜨린다. 홈의 "오늘 새 쿠폰 N개" 배지와
 * 수집 워크플로 로그가 이 파일을 읽는다.
 *
 * 퀴즈는 매일 발행량이 거의 고정이라 눈으로 확인이 되지만, 게임 쿠폰은
 * 게임사가 뿌릴 때만 나온다. 그래서 "오늘 몇 개 새로 붙었나"를 숫자로
 * 남겨두지 않으면 수집기가 죽어도 알아채지 못한다.
 */
import fs from 'node:fs';
import path from 'node:path';

const GAMES_DIR = path.join(process.cwd(), 'data', 'games');
const OUT = path.join(process.cwd(), 'data', 'stats.json');
const KST = 'Asia/Seoul';

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function main() {
  if (!fs.existsSync(GAMES_DIR)) {
    console.error('[stats] data/games 가 없다');
    process.exit(1);
  }
  const today = todayISO();
  const files = fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith('.json'));

  const newByDate = {};        // firstSeen 기준 신규 코드 수
  const expiringSoon = [];     // 7일 안에 만료되는 코드
  let games = 0, active = 0, expired = 0, total = 0, withExpiry = 0, noImage = 0;
  const perGame = [];

  for (const f of files) {
    let g;
    try {
      g = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8'));
    } catch {
      console.error(`[stats] 깨진 JSON: ${f}`);
      continue;
    }
    games++;
    const codes = g.codes || [];
    let a = 0;
    for (const c of codes) {
      total++;
      if (c.firstSeen) newByDate[c.firstSeen] = (newByDate[c.firstSeen] || 0) + 1;
      if (c.expiry) withExpiry++;
      if (c.status === 'active') {
        a++; active++;
        if (c.expiry) {
          const days = Math.round((new Date(c.expiry) - new Date(today)) / 86400000);
          if (days >= 0 && days <= 7) expiringSoon.push({ slug: g.slug, code: c.code, expiry: c.expiry, days });
        }
      } else {
        expired++;
      }
    }
    if (!g.image) noImage++;
    perGame.push({ slug: g.slug, active: a, total: codes.length });
  }

  const dates = Object.keys(newByDate).sort();
  const recent = dates.slice(-14).map((d) => ({ date: d, count: newByDate[d] }));
  expiringSoon.sort((x, y) => x.days - y.days);
  perGame.sort((x, y) => y.active - x.active);

  const stats = {
    generatedAt: new Date().toISOString(),
    today,
    todayNew: newByDate[today] || 0,
    totals: { games, codes: total, active, expired, withExpiry },
    newByDate: recent,
    expiringSoon: expiringSoon.slice(0, 50),
    topGames: perGame.slice(0, 20),
    noImage,
  };

  fs.writeFileSync(OUT, JSON.stringify(stats, null, 2) + '\n');

  console.log(`[stats] ${today} 기준`);
  console.log(`  게임 ${games} · 코드 ${total} (사용가능 ${active} / 만료 ${expired})`);
  console.log(`  만료일 보유 ${withExpiry} (${total ? Math.round((withExpiry / total) * 100) : 0}%)`);
  console.log(`  오늘 신규 코드 ${stats.todayNew}개`);
  console.log(`  7일 내 만료 예정 ${expiringSoon.length}개`);
  if (noImage) console.log(`  ⚠ 이미지 없는 게임 ${noImage}개`);
  console.log('\n  최근 신규 추이:');
  for (const r of recent.slice(-10)) console.log(`    ${r.date}  ${String(r.count).padStart(5)}`);
  console.log(`STATS_TODAY_NEW=${stats.todayNew}`);
}

main();
