import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const dbOnlyInServices = {
  patterns: [
    {
      group: ["@/db/client", "**/db/client"],
      message: "Only src/services and src/server may open database transactions. Call a service instead.",
    },
    {
      group: ["pg", "drizzle-orm/node-postgres"],
      message: "Use @/db/client from a service; raw connections bypass the RLS user context.",
    },
  ],
};

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "next-env.d.ts"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/services/**", "src/server/**", "src/db/**", "src/auth/**"],
    rules: { "no-restricted-imports": ["error", dbOnlyInServices] },
  },
  {
    // authorize() must stay pure: no database, no network.
    files: ["src/authz/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/db/*", "@/services/*", "pg", "drizzle-orm*"], message: "authz is pure." }] },
      ],
    },
  },
];

export default config;
