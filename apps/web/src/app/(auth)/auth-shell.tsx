import { getTranslations } from "next-intl/server";
import { BrandWordmark } from "@/components/brand";
import { Topography } from "@/components/topography";

/** The centred layout every signed-out page shares (sign-in, reset, invite). */
export async function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const tApp = await getTranslations("app");
  return (
    <div className="relative flex min-h-svh items-center justify-center bg-background p-4">
      <Topography />
      <div className="relative w-full max-w-sm animate-page-in space-y-6">
        <div className="space-y-1 text-center">
          <BrandWordmark label={tApp("name")} className="mx-auto mb-6 h-12" />
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
