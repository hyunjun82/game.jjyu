export const dynamic = 'force-static';

import { getAllGames } from '../lib/games';

const SITE_URL = 'https://game.jjyu.co.kr';

export default function sitemap() {
  const games = getAllGames();
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    ...games.map((g) => ({
      url: `${SITE_URL}/${g.slug}/`,
      lastModified: g.updatedAt ? new Date(g.updatedAt) : now,
      changeFrequency: 'daily',
      priority: g.active.length > 0 ? 0.8 : 0.4,
    })),
  ];
}
