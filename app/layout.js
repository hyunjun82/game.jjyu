import './globals.css';

const SITE_URL = 'https://game.jjyu.co.kr';
const SITE_NAME = 'GAMEDAY';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: '게임 쿠폰 코드 모음 — 오늘 쓸 수 있는 쿠폰 전부 | GAMEDAY',
    template: '%s | GAMEDAY',
  },
  description:
    '모바일·PC 게임 쿠폰 코드를 매일 자동으로 모읍니다. 사용 가능한 코드와 보상, 만료일까지 한 번에 확인하세요.',
  keywords: ['게임 쿠폰', '쿠폰 코드', '리딤코드', '교환코드', '기프트코드', '게임 쿠폰 모음'],
  openGraph: { type: 'website', locale: 'ko_KR', siteName: SITE_NAME },
  robots: { index: true, follow: true },
  alternates: { types: { 'application/rss+xml': `${SITE_URL}/rss.xml` } },
  // 파비콘이 없으면 구글 검색결과에 기본 지구본이 뜬다(2026-09-21 실측).
  // 구글은 48px 이상을 요구하고 실제로는 16~20px 로 줄여 그리므로, 작게도 뭉개지지 않는
  // 번개 한 개짜리 마크를 쓴다. ico 에 16·32·48 을 함께 넣었다.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  manifest: '/site.webmanifest',
};

export const viewport = {
  themeColor: '#0a0b10',
};

const siteJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: '게임 쿠폰 코드 모음',
      inLanguage: 'ko-KR',
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    { '@type': 'Organization', '@id': `${SITE_URL}/#org`, name: SITE_NAME, url: SITE_URL },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta name="naver-site-verification" content="dcf8e6e5e911a0494bbe70cf210d71e964ce22c7" />
        <meta
          name="DaumWebMasterTool"
          content="cefd2f4c27a90f00f1479f6fbe34dcf38fb0cae4c3a1ea7ec949fc3a591cc51c:4Q+JZVGYAkx0BbJJkg0XLQ=="
        />
        <link rel="preconnect" href="https://pagead2.googlesyndication.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fundingchoicesmessages.google.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://googleads.g.doubleclick.net" crossOrigin="anonymous" />
        {/* Offerwall 선로드 — 애드센스 뒤에 붙이면 표시가 2초 넘게 밀린다(퀴즈에서 실측). */}
        <script async src="https://fundingchoicesmessages.google.com/i/ca-pub-2442517902625121?ers=1" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){function s(){if(!window.frames['googlefcPresent']){if(document.body){var i=document.createElement('iframe');i.style='width:0;height:0;border:none;z-index:-1000;left:-1000px;top:-1000px;';i.style.display='none';i.name='googlefcPresent';document.body.appendChild(i);}else{setTimeout(s,0);}}}s();})();",
          }}
        />
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2442517902625121"
          crossOrigin="anonymous"
        />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }} />
      </head>
      <body>
        <div className="bg-orb" aria-hidden="true" />
        <header className="site-header">
          <div className="container header-inner">
            <a href="/" className="logo">
              <span className="logo-mark">G</span>
              GAME<em>DAY</em>
            </a>
            <span className="pill">
              <i className="dot" aria-hidden="true" />
              매일 자동 갱신
            </span>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="container">
            <p>
              GAMEDAY는 각 게임사가 공개한 쿠폰 코드를 정리해 제공하는 정보 서비스이며, 각 게임 및 운영사와
              무관합니다. 표기된 게임명·상표는 각 소유자의 자산입니다.
            </p>
            <p>쿠폰은 게임사 사정으로 예고 없이 종료될 수 있습니다.</p>
            <p>© {new Date().getFullYear()} game.jjyu.co.kr</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
