/**
 * 해외 코드 허브(Pocket Gamer)에서만 들어온 게임을 내린다(2026-09-23).
 * 한국 사람이 영문 게임 쿠폰을 한국 사이트에서 찾지 않고, 만료 목록 코드를 사용 가능으로 올리는
 * 문제까지 있었다. 한국 출처(네이버 라운지·검색) 게임은 남기되, 섞여 들어온 해외 코드는 걷어낸다.
 * 이미 정리됐으면 아무것도 안 한다. 지운 주소는 404 로 둔다(app/not-found.js 가 한국 게임으로 안내).
 */
import fs from 'node:fs';
import path from 'node:path';
process.chdir(path.resolve(import.meta.dirname, '..'));
const { loadLounges } = await import('./collect-naver.mjs');
const korean = new Set(loadLounges().map((g) => g.slug));
let del = 0, img = 0, stripped = 0, keptShared = 0;
for (const f of fs.readdirSync('data/games')) {
  const file = `data/games/${f}`;
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const slug = f.slice(0, -5);
  // 같은 게임의 한국 라운지가 목록에 있으면 주소를 살려 둔다 — 해외 코드만 걷어내고,
  // 이어서 도는 collect-naver 가 한국 라운지 코드로 채운다(궁수의 전설2·캣 판타지 등 30개).
  if ((!g.source || g.source === 'pocketgamer') && korean.has(slug)) {
    const before = g.codes.length;
    g.codes = g.codes.filter((c) => c.postedAt || c.sourceUrl);
    if (g.sourcePath || before !== g.codes.length) { stripped += before - g.codes.length; keptShared++; delete g.sourcePath; fs.writeFileSync(file, JSON.stringify(g, null, 2) + '\n'); }
    continue;
  }
  if (!g.source || g.source === 'pocketgamer') {
    fs.unlinkSync(file); del++;
    for (const ext of ['webp', 'png', 'jpg']) { const p = `public/g/${slug}.${ext}`; if (fs.existsSync(p)) { fs.unlinkSync(p); img++; } }
    continue;
  }
  // 한국 출처 파일에 섞인 해외 코드: 게시일(postedAt)도 출처 URL(sourceUrl)도 없는 코드
  const before = g.codes.length;
  g.codes = g.codes.filter((c) => c.postedAt || c.sourceUrl);
  if (g.sourcePath || before !== g.codes.length) { stripped += before - g.codes.length; keptShared++; delete g.sourcePath; fs.writeFileSync(file, JSON.stringify(g, null, 2) + '\n'); }
}
console.log({ 삭제게임: del, 삭제이미지: img, 공유게임정리: keptShared, 걷어낸해외코드: stripped, 남은게임: fs.readdirSync('data/games').length });
