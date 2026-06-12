/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // L'API backend tourne sur 8000 - on rewrite /api -> http://localhost:8000/api
  // afin d'avoir un proxy clean en dev et d'éviter les soucis CORS.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: process.env.NEXT_PUBLIC_API_URL
          ? `${process.env.NEXT_PUBLIC_API_URL}/api/:path*`
          : "http://localhost:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
