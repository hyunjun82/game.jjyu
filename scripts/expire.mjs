/**
 * 만료일이 지난 코드를 expired 로 내린다(모든 게임 파일).
 * 수집이 자정(KST)을 넘겨 끝나거나, 이번 실행에서 다시 읽지 않은 게임(블로그 검색 등)은
 * 어제 만료된 코드가 active 로 남는다 — 발행 점검이 이걸로 실패했다(2026-09-29 자가 점검 #1).
 * 커밋·점검 직전에 한 번 돌린다.
 */
import fs from 'node:fs';
import path from 'node:path';
const DIR = path.join(path.resolve(import.meta.dirname, '..'), 'data', 'games');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let n = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  const file = path.join(DIR, f);
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = false;
  for (const c of g.codes || []) if (c.status === 'active' && c.expiry && c.expiry < today) { c.status = 'expired'; changed = true; n++; }
  if (changed) fs.writeFileSync(file, JSON.stringify(g, null, 2) + '\n');
}
console.log(`[expire] 만료일 지난 코드 ${n}개 내림`);
