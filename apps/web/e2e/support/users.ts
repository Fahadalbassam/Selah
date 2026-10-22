import { readFileSync } from "node:fs";

// The users db:seed creates (scripts/seed.ts). Password: SEED_PASSWORD.
export const USERS = {
  sara: { email: "sara@mizan.example", role: "firm_admin", twoFactor: true },
  khalid: { email: "khalid@mizan.example", role: "consultant", twoFactor: true }, // leads Al-Nukhba and Waha
  noura: { email: "noura@mizan.example", role: "consultant", twoFactor: true }, // leads Rawdah
  fahd: { email: "fahd@nukhba.example", role: "client_admin", twoFactor: true },
  reem: { email: "reem@nukhba.example", role: "client_manager", twoFactor: false },
  abdullah: { email: "abdullah@nukhba.example", role: "action_owner", twoFactor: false },
  hind: { email: "hind@rawdah.example", role: "client_manager", twoFactor: false },
} as const;
export type UserKey = keyof typeof USERS;
/** SEED_PASSWORD from the environment, or from the root .env that docker compose reads. */
function seedPassword(): string {
  if (process.env.SEED_PASSWORD) return process.env.SEED_PASSWORD;
  try {
    const line = readFileSync("../../.env", "utf8").split("\n").find((l) => l.startsWith("SEED_PASSWORD="));
    return line?.slice("SEED_PASSWORD=".length).replace(/^"|"$/g, "") ?? "";
  } catch {
    return "";
  }
}
export const PASSWORD = seedPassword();
export const authFile = (u: UserKey) => `e2e/.auth/${u}.json`;
export const SECRETS = "e2e/.auth/totp.json";
