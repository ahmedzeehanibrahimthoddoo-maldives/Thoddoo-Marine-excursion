import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  async redirects() {
    // Public marketing pages were consolidated into the single landing page.
    // Keep old links (bookmarks, QR codes, WhatsApp messages) working.
    const legacy = [
      ["/adventures", "/#adventures"],
      ["/adventures/:slug", "/#adventures"],
      ["/watersports", "/#watersports"],
      ["/watersports/:slug", "/#watersports"],
      ["/about", "/#about"],
      ["/gallery", "/#gallery"],
      ["/contact", "/#contact"],
      ["/explore-thoddoo", "/#explore"],
    ] as const;
    return legacy.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
