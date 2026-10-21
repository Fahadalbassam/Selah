import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Topography } from "@/components/topography";
import { withAnonymous } from "@/server/page";
import { intakeOptions } from "@/services/intake";
import { InquiryForm } from "./inquiry-form";
import { InquiryIntro } from "./inquiry-intro";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("inquiry"))("metaTitle") };
}

// Rendered per request so the service and sector lists follow what the
// firm's admins have switched on.
export const dynamic = "force-dynamic";

/** The public inquiry form. Submits to POST /api/inquiries; no account needed. */
export default async function InquiryPage() {
  const [options, locale] = await Promise.all([withAnonymous((tx) => intakeOptions(tx)), getLocale()]);
  const name = (o: { nameAr: string; nameEn: string }) => (locale === "ar" ? o.nameAr : o.nameEn);
  return (
    <div className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden">
      <Topography className="-z-10" />
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:py-16">
        <InquiryIntro />
        <InquiryForm
          locale={locale === "en" ? "en" : "ar"}
          options={{
            services: options.services.map((s) => ({ code: s.code, label: name(s) })),
            sectors: options.sectors.map((s) => ({ code: s.code, label: name(s) })),
            employeeBands: [...options.employeeBands],
            ownershipTypes: [...options.ownershipTypes],
            urgencies: [...options.urgencies],
            heardFrom: [...options.heardFrom],
            privacyNoticeVersion: options.privacyNoticeVersion,
          }}
        />
      </div>
    </div>
  );
}
