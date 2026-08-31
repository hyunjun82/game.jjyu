/** @type {import('next').NextConfig} */
const nextConfig = {
  // 정적 내보내기: Cloudflare Workers 에 out/ 을 그대로 올린다 (퀴즈와 동일 구조)
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
