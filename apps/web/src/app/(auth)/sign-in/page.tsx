import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasSession } from "@/server/page";
import { AuthShell } from "../auth-shell";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const { error, done } = await searchParams;
  if (!error && (await hasSession())) redirect("/");
  const t = await getTranslations("signIn");
  const notice = done === "invited" || done === "reset" || done === "email" ? t(`done.${done}`) : null;
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      {error === "no_access" ? <p className="text-center text-sm text-destructive">{t("noAccess")}</p> : null}
      {notice ? <p className="text-center text-sm text-foreground">{notice}</p> : null}
      <SignInForm />
      <p className="text-center text-sm text-muted-foreground">
        {t("newHere")}{" "}
        <Link href="/inquiry" className="font-medium text-foreground underline-offset-4 hover:underline">
          {t("inquiry")}
        </Link>
      </p>
    </AuthShell>
  );
}
