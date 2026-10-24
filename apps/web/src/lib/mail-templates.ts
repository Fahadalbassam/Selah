// The text of each queued mail (outbound_emails.kind). Pure, so the sender
// and the tests share it. Mails carry a link and a line, never content: the
// reader signs in to see anything. Every mail is Arabic first, then English,
// because the queue does not know the reader's language.

export const MAIL_KINDS = [
  "invitation",
  "email_change.confirm",
  "email_change.notice",
  "access_review.due",
  "meeting.invite",
  "meeting.cancel",
  "password_reset",
  "password_reset.notice",
  "two_factor.reset",
  "inquiry.new",
  "inquiry.received",
  "inquiry.declined",
  "action.assigned",
  "action.revision_requested",
  "action.verified_complete",
  "evidence.requested",
  "follow_up.digest",
] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

interface Copy {
  subject: string;
  lines: string[];
  action?: string;
}

const COPY: Record<MailKind, { ar: Copy; en: Copy }> = {
  invitation: {
    ar: { subject: "دعوة للانضمام إلى صلة", lines: ["تمت دعوتك إلى صلة.", "الرابط صالح لمدة 7 أيام."], action: "قبول الدعوة" },
    en: {
      subject: "You're invited to Selah",
      lines: ["You have been invited to Selah.", "The link works for 7 days."],
      action: "Accept the invitation",
    },
  },
  "email_change.confirm": {
    ar: {
      subject: "أكّد عنوان بريدك الجديد",
      lines: ["غيّر مسؤول حسابك عنوان بريدك في صلة إلى هذا العنوان.", "الرابط صالح لمدة يومين."],
      action: "تأكيد العنوان",
    },
    en: {
      subject: "Confirm your new address",
      lines: ["Your administrator changed your Selah address to this one.", "The link works for 2 days."],
      action: "Confirm the address",
    },
  },
  "email_change.notice": {
    ar: {
      subject: "تغيّر عنوان بريدك في صلة",
      lines: ["نُقل حسابك في صلة إلى عنوان آخر، وانتهت جميع جلساته.", "إن لم تكن تتوقع ذلك فتواصل مع مسؤول حسابك."],
    },
    en: {
      subject: "Your Selah address was changed",
      lines: [
        "Your Selah account was moved to another address, and every session was signed out.",
        "If you did not expect this, contact your administrator.",
      ],
    },
  },
  "access_review.due": {
    ar: {
      subject: "مراجعة صلاحيات الوصول",
      lines: ["حان وقت مراجعة من لا يزال لديه وصول إلى صلة في منظمتك."],
      action: "مراجعة الأشخاص",
    },
    en: {
      subject: "Time to review access",
      lines: ["It's time to review who in your organisation still has access to Selah."],
      action: "Review people",
    },
  },
  "meeting.invite": {
    ar: { subject: "دعوة اجتماع", lines: ["دعوة الاجتماع مرفقة. افتحها لإضافتها إلى تقويمك."] },
    en: { subject: "Meeting invitation", lines: ["The meeting invitation is attached. Open it to add it to your calendar."] },
  },
  "meeting.cancel": {
    ar: { subject: "أُلغي الاجتماع", lines: ["أُلغي الاجتماع. افتح المرفق لإزالته من تقويمك."] },
    en: {
      subject: "Meeting cancelled",
      lines: ["The meeting was cancelled. Open the attachment to remove it from your calendar."],
    },
  },
  password_reset: {
    ar: {
      subject: "إعادة تعيين كلمة المرور",
      lines: ["طُلب تعيين كلمة مرور جديدة لحسابك في صلة.", "الرابط صالح لمدة ساعة. إن لم تطلب ذلك فتجاهل هذه الرسالة."],
      action: "تعيين كلمة مرور جديدة",
    },
    en: {
      subject: "Reset your password",
      lines: [
        "Someone asked to set a new password for your Selah account.",
        "The link works for one hour. If it wasn't you, ignore this mail.",
      ],
      action: "Set a new password",
    },
  },
  "password_reset.notice": {
    ar: {
      subject: "تغيّرت كلمة مرورك",
      lines: ["عُيّنت كلمة مرور جديدة لحسابك في صلة، وانتهت جميع جلساته.", "إن لم تكن أنت فتواصل مع مسؤول حسابك فوراً."],
    },
    en: {
      subject: "Your password was changed",
      lines: [
        "A new password was set for your Selah account, and every session was signed out.",
        "If this wasn't you, contact your administrator now.",
      ],
    },
  },
  "two_factor.reset": {
    ar: {
      subject: "أُعيد ضبط التحقق بخطوتين",
      lines: [
        "أعاد مسؤول حسابك ضبط التحقق بخطوتين لحسابك في صلة، وانتهت جميع جلساته.",
        "ستُعِدّه من جديد عند تسجيل الدخول التالي. إن لم تطلب ذلك فتواصل مع مسؤول حسابك.",
      ],
    },
    en: {
      subject: "Your two-factor sign-in was reset",
      lines: [
        "Your administrator reset two-factor sign-in for your Selah account, and every session was signed out.",
        "You'll set it up again at your next sign-in. If you didn't ask for this, contact your administrator.",
      ],
    },
  },
  "inquiry.new": {
    ar: { subject: "استفسار جديد", lines: ["وصل استفسار جديد عبر نموذج الموقع. سجّل الدخول لقراءته."], action: "فتح الاستفسار" },
    en: {
      subject: "New inquiry",
      lines: ["A new inquiry came in through the website form. Sign in to read it."],
      action: "Open the inquiry",
    },
  },
  // Action events (baseline: Action mail): to the action's owner, never with its title.
  // To the person who sent an inquiry. {ref} is its reference; nothing else of it.
  "inquiry.received": {
    ar: {
      subject: "استلمنا طلبك",
      lines: [
        "شكرًا لتواصلك معنا. استلمنا طلبك، ورقمه المرجعي {ref}.",
        "سيتواصل معك أحد أعضاء فريقنا قريبًا. نرجو ألّا ترسل أي مستندات سرية قبل توقيع اتفاقية عدم إفصاح.",
        "إن لم تكن أنت من أرسل هذا الطلب فيمكنك تجاهل هذه الرسالة.",
      ],
    },
    en: {
      subject: "We received your request",
      lines: [
        "Thank you for getting in touch. We received your request; its reference is {ref}.",
        "Someone from our team will contact you soon. Please don't send confidential documents before a non-disclosure agreement is signed.",
        "If you didn't send this request, you can ignore this mail.",
      ],
    },
  },
  "inquiry.declined": {
    ar: {
      subject: "بخصوص طلبك",
      lines: [
        "شكرًا لاهتمامك بخدماتنا. راجعنا طلبك ذا الرقم المرجعي {ref}، ونعتذر عن عدم قدرتنا على المضيّ فيه في الوقت الحالي.",
        "نتمنى لكم التوفيق، ويسعدنا تواصلكم معنا مستقبلًا.",
      ],
    },
    en: {
      subject: "About your request",
      lines: [
        "Thank you for your interest in our services. We reviewed your request {ref} and are sorry that we can't take it forward at this time.",
        "We wish you every success and would be glad to hear from you in the future.",
      ],
    },
  },
  "action.assigned": {
    ar: { subject: "إجراء جديد مُسند إليك", lines: ["أُسند إليك إجراء في صلة.", "سجّل الدخول لترى ما المطلوب وموعد التسليم."], action: "فتح الإجراء" },
    en: {
      subject: "An action is assigned to you",
      lines: ["An action in Selah is now yours.", "Sign in to see what it needs and when it's due."],
      action: "Open the action",
    },
  },
  "action.revision_requested": {
    ar: {
      subject: "طُلب تعديل على إجراء",
      lines: ["راجع المستشار ما أرسلته وطلب تعديلاً.", "سجّل الدخول لقراءة السبب."],
      action: "فتح الإجراء",
    },
    en: {
      subject: "A revision was requested",
      lines: ["The consultant reviewed what you sent and asked for a change.", "Sign in to read why."],
      action: "Open the action",
    },
  },
  "action.verified_complete": {
    ar: { subject: "تم التحقق من إنجاز إجراء", lines: ["تحقق المستشار من إنجاز أحد إجراءاتك، ولم يعد مطلوباً منك فيه شيء."], action: "فتح الإجراء" },
    en: {
      subject: "An action was verified",
      lines: ["The consultant verified one of your actions as complete. Nothing more is needed on it."],
      action: "Open the action",
    },
  },
  "evidence.requested": {
    ar: { subject: "مطلوب دليل على إجراء", lines: ["طلب المستشار دليلاً إضافياً على أحد إجراءاتك.", "سجّل الدخول لترى ما المطلوب."], action: "فتح الإجراء" },
    en: {
      subject: "Evidence requested",
      lines: ["The consultant asked for another piece of evidence on one of your actions.", "Sign in to see what's needed."],
      action: "Open the action",
    },
  },
  // The reminder job's daily summary (src/jobs/follow-ups.ts): no titles, no counts.
  "follow_up.digest": {
    ar: {
      subject: "تذكيرات اليوم في صلة",
      lines: ["لديك تذكيرات جديدة بإجراءات قرب موعدها أو تأخرت.", "سجّل الدخول لتراها. يمكنك إيقاف هذه الرسالة من صفحة الإشعارات."],
      action: "فتح الإشعارات",
    },
    en: {
      subject: "Today's reminders in Selah",
      lines: [
        "You have new reminders about actions that are due soon or overdue.",
        "Sign in to see them. You can turn this mail off on the notifications page.",
      ],
      action: "Open notifications",
    },
  },
};

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `link` is the path stored in the queue; it is joined to the site's address. `reference` fills {ref}. */
export function renderMail(kind: MailKind, link: string | null, appUrl: string, reference: string | null = null): RenderedMail {
  const fill = (c: Copy): Copy => ({ ...c, lines: c.lines.map((l) => l.replace("{ref}", reference ?? "")) });
  const copy = { ar: fill(COPY[kind].ar), en: fill(COPY[kind].en) };
  const url = link ? new URL(link, appUrl).toString() : null;
  const subject = `${copy.ar.subject} | ${copy.en.subject}`;

  const textPart = (c: Copy) => [...c.lines, ...(url && c.action ? [`${c.action}: ${url}`] : [])].join("\n");
  const text = `${textPart(copy.ar)}\n\n---\n\n${textPart(copy.en)}\n`;

  const htmlPart = (c: Copy, dir: "rtl" | "ltr", lang: string) =>
    `<div dir="${dir}" lang="${lang}" style="text-align:${dir === "rtl" ? "right" : "left"}">` +
    c.lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join("") +
    (url && c.action
      ? `<p style="margin:16px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(c.action)}</a></p>`
      : "") +
    `</div>`;
  const html =
    `<!doctype html><html><body style="font-family:system-ui,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:560px;margin:0 auto;padding:24px">` +
    htmlPart(copy.ar, "rtl", "ar") +
    `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0">` +
    htmlPart(copy.en, "ltr", "en") +
    (url ? `<p style="font-size:12px;color:#666;direction:ltr;word-break:break-all">${escapeHtml(url)}</p>` : "") +
    `</body></html>`;
  return { subject, text, html };
}

/** Wait before the next try, by tries so far: 1, 5, 15 minutes, 1, 3, 6, 12 hours. */
export function retryDelayMinutes(attempts: number): number {
  const steps = [1, 5, 15, 60, 180, 360, 720];
  return steps[Math.min(Math.max(attempts, 1), steps.length) - 1]!;
}

export const MAX_ATTEMPTS = 8;
