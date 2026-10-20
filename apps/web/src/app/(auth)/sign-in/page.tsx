import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BrandWordmark } from "@/components/brand";
import { hasSession } from "@/server/page";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (!error && (await hasSession())) redirect("/");
  const [t, tApp] = await Promise.all([getTranslations("signIn"), getTranslations("app")]);
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <BrandWordmark label={tApp("name")} className="mx-auto mb-6 h-12" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {error === "no_access" ? <p className="text-center text-sm text-destructive">{t("noAccess")}</p> : null}
        <SignInForm />
      </div>
    </div>
  );
}
