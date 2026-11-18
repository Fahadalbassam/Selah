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
  // Old addresses of pages that moved, sent on for good before anything is drawn.
  async redirects() {
    return [
      // The inquiry privacy notice joined the legal set (page audit row 51).
      { source: "/privacy", destination: "/legal/inquiry-privacy", permanent: true },
      // The review queue and Oversight became filters of the Actions list (page audit rows 8 and 9, D2);
      // Oversight's per-project columns are the Projects table (/projects?view=table).
      { source: "/review", destination: "/actions?filter=awaiting-review", permanent: true },
      { source: "/oversight", destination: "/actions?filter=late", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: apiCsp }] },
    ];
  },
};

export default withNextIntl(config);
