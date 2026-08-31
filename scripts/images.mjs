/**
 * 게임 대표 이미지를 받아서 public/g/<slug>.webp 로 저장한다.
 *
 * 왜 직접 받아두는가
 *   원본(media.pocketgamer.com)은 핫링크를 막는다. 브라우저에서 Referer 가 붙으면
 *   대부분 빈 이미지로 떨어진다(2026-08-31 실측: 카드 한 장만 뜨고 나머지 전멸).
 *   카드에 그림이 없으면 목록이 글자 나열이 되므로, 받아서 우리 정적 자산으로 낸다.
 *
 * 카드에 실제로 그려지는 크기는 200px 안쪽이라 480px 로 줄여 담는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const GAMES_DIR = path.join(ROOT, 'data', 'games');
const OUT_DIR = path.join(ROOT, 'public', 'g');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchImage(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch { /* 재시도 */ }
    await sleep(500 * (i + 1));
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith('.json'));
  const jobs = [];
  for (const f of files) {
    const g = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8'));
    if (!g.image) continue;
    const out = path.join(OUT_DIR, `${g.slug}.webp`);
    if (fs.existsSync(out) && !process.argv.includes('--force')) continue;
    jobs.push({ slug: g.slug, url: g.image, out });
  }

  console.log(`[images] ${jobs.length}장 내려받기`);
  let ok = 0, fail = 0;
  const C = 8;
  for (let i = 0; i < jobs.length; i += C) {
    await Promise.all(
      jobs.slice(i, i + C).map(async (j) => {
        const buf = await fetchImage(j.url);
        if (!buf) { fail++; return; }
        try {
          await sharp(buf).resize(480, 300, { fit: 'cover', position: 'attention' })
            .webp({ quality: 72 }).toFile(j.out);
          ok++;
        } catch { fail++; }
      })
    );
    process.stdout.write(`\r  ${Math.min(i + C, jobs.length)}/${jobs.length}`);
  }
  console.log(`\n[images] 완료 — 성공 ${ok} · 실패 ${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
