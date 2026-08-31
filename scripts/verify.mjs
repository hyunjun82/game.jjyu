/**
 * 발행 점검. 퀴즈의 verify.mjs 와 같은 역할.
 *
 * 수집기가 조용히 망가지는 경우가 제일 무섭다 — 페이지는 멀쩡히 뜨는데
 * 데이터가 며칠째 그대로이거나, 코드가 통째로 날아가 있거나, 만료된
 * 코드가 사용가능으로 남아 있는 상황. 그래서 아래를 매번 확인한다.
 *
 * 종료코드 1 이면 문제가 있다는 뜻이다.
 */
import fs from 'node:fs';
import path from 'node:path';

const GAMES_DIR = path.join(process.cwd(), 'data', 'games');
const PUB_G = path.join(process.cwd(), 'public', 'g');
const KST = 'Asia/Seoul';
const STALE_HOURS = 12; // 3시간마다 도니 12시간이면 4번 연속 실패한 것

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

const problems = [];
const warns = [];

function main() {
  const today = todayISO();
  const files = fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith('.json'));

  if (files.length === 0) problems.push('data/games 가 비어 있다');

  let newest = '';
  let staleExpiry = 0, emptyGames = 0, dupCodes = 0, badCode = 0, missingImg = 0;

  for (const f of files) {
    let g;
    try {
      g = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8'));
    } catch (e) {
      problems.push(`깨진 JSON: ${f}`);
      continue;
    }
    if (!g.slug) { problems.push(`slug 없음: ${f}`); continue; }
    if (g.updatedAt && g.updatedAt > newest) newest = g.updatedAt;

    const codes = g.codes || [];
    if (codes.length === 0) emptyGames++;

    const seen = new Set();
    for (const c of codes) {
      if (!c.code || typeof c.code !== 'string') { badCode++; continue; }
      const k = c.code.toUpperCase();
      if (seen.has(k)) dupCodes++;
      seen.add(k);
      // 만료일이 지났는데 아직 active 인 코드 — collect 의 만료 처리가 안 돈 것
      if (c.status === 'active' && c.expiry && c.expiry < today) staleExpiry++;
    }

    // 이미지: 데이터에는 image 가 있는데 public/g 에 파일이 없는 경우
    if (fs.existsSync(PUB_G)) {
      const hasFile = ['avif', 'webp', 'jpg', 'png'].some((ext) =>
        fs.existsSync(path.join(PUB_G, `${g.slug}.${ext}`)),
      );
      if (!hasFile) missingImg++;
    }
  }

  // 수집이 멈췄는지
  if (newest) {
    const hours = (Date.now() - new Date(newest).getTime()) / 3600000;
    if (hours > STALE_HOURS) {
      problems.push(`수집이 ${hours.toFixed(1)}시간째 멈춰 있다 (마지막: ${newest})`);
    }
  } else {
    problems.push('updatedAt 이 있는 게임이 하나도 없다');
  }

  if (staleExpiry > 0) problems.push(`만료일이 지났는데 사용가능으로 남은 코드 ${staleExpiry}개`);
  if (badCode > 0) problems.push(`코드 값이 이상한 항목 ${badCode}개`);
  if (dupCodes > 0) warns.push(`중복 코드 ${dupCodes}개`);
  if (emptyGames > 0) warns.push(`코드가 하나도 없는 게임 ${emptyGames}개`);
  if (missingImg > 0) warns.push(`이미지 파일이 없는 게임 ${missingImg}개`);

  console.log(`[verify] 게임 ${files.length}개 · 마지막 수집 ${newest || '없음'}`);
  for (const w of warns) console.log(`  ⚠ ${w}`);
  if (problems.length === 0) {
    console.log('  ✅ 이상 없음');
    process.exit(0);
  }
  for (const p of problems) console.error(`  ❌ ${p}`);
  process.exit(1);
}

main();
