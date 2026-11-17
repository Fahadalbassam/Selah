import Link from "next/link";
import { AuthShell } from "./auth-shell";

/**
 * What every page a mail link opens shows when its link is dead (malformed,
 * unknown, expired, withdrawn or already used): it says so at once, in the
 * reader's language, and offers one way on. The page finds out when it loads,
 * with a check that uses nothing up. One wording for every dead case, so the
 * page never says whether an account or a request exists.
 */
export function DeadLink({ title, body, href, action }: { title: string; body: string; href: string; action: string }) {
  return (
    <AuthShell title={title} subtitle={body}>
      <p className="text-center text-sm">
        <Link href={href} className="font-medium text-foreground underline underline-offset-4">
          {action}
        </Link>
      </p>
    </AuthShell>
  );
}
