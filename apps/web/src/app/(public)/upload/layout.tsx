import type { ReactNode } from "react";
import { PublicFrame } from "../public-frame";

// The no-login upload page: the header without the sign-in button and without
// a link on the wordmark. The page hands its form its own strings.
export default function Layout({ children }: { children: ReactNode }) {
  return <PublicFrame bare>{children}</PublicFrame>;
}
