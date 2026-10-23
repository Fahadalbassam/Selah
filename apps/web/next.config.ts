import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Security headers (ASVS V3). Pages get a nonce-based CSP from src/proxy.ts;
// API responses are data and files, never pages, so nothing may run in them.
const apiCsp = "default-src 'none'; frame-ancestors 'none'";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const config: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  // The PDF export reads its fonts from disk (services/pdf.ts); make sure the standalone build carries them.
  outputFileTracingIncludes: {
    "/api/reports/[id]/pdf": ["./node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-{arabic,latin}-{400,600}-normal.woff2"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: apiCsp }] },
    ];
  },
};

export default withNextIntl(config);
