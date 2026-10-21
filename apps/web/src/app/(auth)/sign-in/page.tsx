import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BrandWordmark } from "@/components/brand";
import { Topography } from "@/components/topography";
import { hasSession } from "@/server/page";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (!error && (await hasSession())) redirect("/");
  const [t, tApp] = await Promise.all([getTranslations("signIn"), getTranslations("app")]);
  return (
    <div className="relative flex min-h-svh items-center justify-center bg-background p-4">
      <Topography />
      <div className="relative w-full max-w-sm animate-page-in space-y-6">
        <div className="space-y-1 text-center">
          <BrandWordmark label={tApp("name")} className="mx-auto mb-6 h-12" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {error === "no_access" ? <p className="text-center text-sm text-destructive">{t("noAccess")}</p> : null}
        <SignInForm />
        <p className="text-center text-sm text-muted-foreground">
          {t("newHere")}{" "}
          <Link href="/inquiry" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t("inquiry")}
          </Link>
        </p>
      </div>
    </div>
  );
}
