# Page audit: the pages a signed-out person sees

Captured 16 Nov 2026 on the review copy (http://localhost:3010), Arabic and English, 1280x800 and (Arabic) 768x1024, plus English dark for sign-in, inquiry, upload and one legal page.

- Screenshots and records: `docs/review/shots/phase1/public/<ar|en>/` (`index.txt`, `pages.json`), mails in `public/mails/`, keyboard and flow notes in `public/notes-*.json`.
- Scripts: `apps/web/scripts/review/public/` (`01-static` to `07-mails`).
- Evidence paths below are relative to `docs/review/shots/phase1/`.

What was done to the data, and what was not:

- One fictional inquiry was sent (reference INQ-A90915D0, "شركة تجربة المراجعة", `audit-check@example.test`).
- One no-login upload link was made by lead@mizan.test for the request item "عقد التأسيس وتعديلاته" of "حوكمة مجلس الإدارة", mailed to `audit-check@example.test`. No file was uploaded. The link is still live for 7 days; it can be revoked from the Requests tab.
- One password reset and one sign-in link were asked for owner@nukhba.test. The reset was not completed. The sign-in link was used once in a throwaway browser.
- Two password sign-ins were tried, both wrong on purpose (one unknown address, one known).

Not captured, described from the code instead:

- **`/invite/:token` with a valid invitation.** Mailpit holds no invitation mail (11 mails: 5 meeting invitations, 3 inquiry confirmations, and the 3 this audit caused). Making an invitation was outside what I was allowed to do. Only the dead-link state is captured.
- **`/consent` in English, and its record.** The main capture saved the Arabic screenshots under `owner_at_rawdah.test/ar/` just before I finished; its `pages.json` and the English pass were not there yet. The counts in the table are from the code.
- **The code step of two-step sign-in** and **the "too many attempts" message** (I did not lock an account).
- **The confirmation screen of the inquiry form** was first captured too early (still "sending"). It was captured again with the form's request answered inside the browser, using the real reference. No second inquiry exists.

---

## 1. One row per page

| Route | Roles | Purpose | Controls | First screen 1280x800 | First screen 768x1024 | Verdict | Reason | Evidence |
|---|---|---|---|---|---|---|---|---|
| `/sign-in` (password form; also where `/`, `/consent`, `/security` and any app address send a signed-out visitor) | anyone | Sign in with e-mail and password, or ask for a link by mail. | 2 buttons, 2 links, 2 fields. No menus. | Wordmark, title, one card, all visible. No language switch. | Same, centred. No overflow. | **keep** | One job, one solid button, everything on one screen. Needs a language switch and a plainer line under the link button. | `public/ar/01-sign-in-1280.png`, `public/ar/01-sign-in-768.png`, `public/en/01-sign-in-dark-1280.png` |
| `/sign-in` states: wrong password, link asked, notices after invite / reset / e-mail change, dead link, "no access" | anyone | Tell the person what just happened. | same form; "link asked" has 1 button | One red or black line above or inside the card. | Same. | **keep** | Messages are plain, in the right language, and the same for a known and an unknown address. | `public/ar/08-sign-in-wrong-password-unknown-address-1280.png`, `public/ar/09-sign-in-wrong-password-known-address-1280.png`, `public/ar/11-sign-in-link-asked-1280.png`, `public/ar/03-sign-in-error-link-1280.png`, `public/ar/04-sign-in-done-invited-1280.png`, `public/ar/02-sign-in-error-no-access-1280.png` |
| `/sign-in` code step (two-step sign-in) | accounts with two-step on | Type the 6-digit code or a backup code. | 2 buttons, 1 field (from code) | not captured | not captured | **keep** | From the code: one field, one solid button, a link to switch to a backup code. | none (code: `(auth)/sign-in/sign-in-form.tsx`) |
| `/sign-in/link/:token` | holder of a sign-in link mail (client managers, action owners) | Press one button to finish signing in (so a mail scanner cannot use the link up). | 1 button. | Wordmark, title "الدخول إلى صلة", one button, one line. | Same. | **keep** | The extra press has a real reason. The page throws a hydration error on every load (see part 2). | `public/ar/22-sign-in-link-real-1280.png`, `public/ar/24-after-sign-in-link-1280.png`, `public/ar/25-sign-in-link-used-twice-1280.png`, `public/ar/20-sign-in-link-bad-token-1280.png` |
| `/forgot-password` | anyone | Ask for a reset link by mail. | 1 button, 1 link, 1 field. | One field, one button. | Same. | **keep** | Smallest possible page. Same answer whether the address has an account or not. | `public/ar/10-forgot-password-1280.png`, `public/ar/12-forgot-password-sent-1280.png`, `public/en/12-forgot-password-sent-unknown-address-1280.png` |
| `/reset-password/:token` | holder of a reset mail | Choose a new password. | 1 button, 1 link, 2 fields. | Two fields, rule "12 to 128 characters", one button. | Same. | **keep** | Clear. But a dead link is only found out after typing the password twice (see part 2). | `public/ar/32-reset-password-real-link-1280.png`, `public/ar/33-reset-password-mismatch-1280.png`, `public/ar/34-reset-password-dead-link-after-submit-1280.png`, `public/ar/30-reset-password-bad-token-1280.png` |
| `/invite/:token` | holder of an invitation mail | Create the account: confirm the name and choose a password. | 1 button, 4 fields, one read-only (from code) | valid state not captured. Dead state: wordmark, title, two lines, nothing to press. | Dead state: same. | **keep** | From the code the valid page names the organisation and the role ("انضم إلى {org}", "دُعيت بصفة {role}"). The dead state is a dead end. | `public/ar/40-invite-bad-token-1280.png`, `public/ar/41-invite-wellformed-fake-1280.png` |
| `/confirm-email/:token` | holder of an address-change mail | Confirm the new sign-in address with one button. | 1 button. | Title, one sentence, one button. | Same. | **keep** | One job. The page shows the button for any well-formed token and learns it is dead only after the press. | `public/ar/51-confirm-email-wellformed-fake-1280.png`, `public/ar/52-confirm-email-dead-link-after-press-1280.png`, `public/ar/50-confirm-email-bad-token-1280.png` |
| `/consent` | every account at first sign-in (captured by the main crawl: owner@rawdah.test) | Accept the terms, the privacy notice and the AI notice, one tick each. | 2 buttons, 3 ticks, 3 links (from code) | Three cards, each with a one-line summary, a link to the full text and a tick. "قبول ومتابعة" sits on the bottom edge; "ليس الآن، تسجيل الخروج" is cut off by the fold. | Everything fits. | **keep** | Short, and needed before anything else opens. One summary disagrees with another page (part 2). No language switch. | `owner_at_rawdah.test/ar/001-consent-1280.png`, `owner_at_rawdah.test/ar/001-consent-768.png` |
| `/security` | any signed-in account (captured: lead@mizan.test) | Set up, renew or switch off two-step sign-in. | 1 button, 1 link, 1 field. | Title, one paragraph, password field, one button, "back to Selah". | Same. | **keep** | Small and clear. Nothing was switched on. | `public/ar/62-security-lead-1280.png`, `public/en/62-security-lead-1280.png` |
| `/inquiry` step 1 "المنشأة" | anyone | Give the organisation's name and sector. | 3 (step button, sector list, Continue), 2 text fields. | Left: form card, fully visible. Right: title and "what happens next". The title is typed in by an animation and is one letter in the first capture. | Intro on top (470 px), form below, Continue visible. | **merge** into step 2 | Three fields, two of them required, do not need a screen of their own. With "الاسم بالعربية" dropped (it confuses an Arabic visitor, part 2) only two fields move. | `public/ar/70-inquiry-1280.png`, `public/ar/71-inquiry-step1-1280.png`, `public/ar/71-inquiry-step1-errors-1280.png`, `public/ar/70-inquiry-768.png` |
| `/inquiry` step 2 "بيانات التواصل" | anyone | Say who you are and how to reach you. | 10 buttons, 6 fields. | Whole step visible; Continue at the bottom edge. | 1.2 screens; Continue below the fold. | **trim** ("المسمى الوظيفي") | "دورك في المنشأة" (required list) and "المسمى الوظيفي" (optional text) ask the same thing twice. | `public/ar/72-inquiry-step2-1280.png`, `public/ar/72-inquiry-step2-errors-email-and-phone-1280-full.png`, `public/ar/72-inquiry-step2-768.png` |
| `/inquiry` step 3 "ما تحتاجه" | anyone | Pick the services and say why now. | 16 buttons, 4 fields. | Seven service boxes and "لماذا الآن؟". The optional fields and Continue are below the fold (1.5 screens). | 1.5 screens. | **keep** | This is the heart of the form. Both required answers are on the first screen. | `public/ar/73-inquiry-step3-1280.png`, `public/ar/73-inquiry-step3-errors-1280-full.png` |
| `/inquiry` step 4 "عن منشأتك" | anyone | Optional context: ownership, size, three family-business questions, six yes/no questions. | 23 buttons; 35 with the family questions. 2 fields. | Says "all optional" on the first line. Continue is below the fold (1.4 to 1.9 screens). | 1.4 to 1.8 screens. | **keep** | Optional and says so first. It is the longest step; see the open question on the six yes/no questions. | `public/ar/74-inquiry-step4-1280.png`, `public/ar/74-inquiry-step4-family-questions-1280-full.png` |
| `/inquiry` step 5 "المراجعة" | anyone | Check the answers, accept the privacy notice, send. | 13 buttons (5 step buttons, 4 "تعديل", 2 ticks, Back, Send), 1 link. | Summary table. The consent tick and "إرسال الطلب" are below the fold (1.5 screens). | 1.4 screens. | **keep** | A review before sending is right. It leaves out three answers (part 2). | `public/ar/75-inquiry-step5-review-1280.png`, `public/ar/75-inquiry-step5-error-no-consent-1280-full.png` |
| `/inquiry` confirmation | anyone | Say the inquiry arrived and give its reference. | 2 buttons (copy, send another). | Tick, "شكرًا لك، استلمنا طلبك", the address, the reference. | Same, under the intro. | **keep** | Says what happens next and gives a reference. The page title beside it still says "حدّثنا عن منشأتك". | `public/ar/76-inquiry-sent-1280.png`, `public/en/76-inquiry-sent-1280.png` |
| `/privacy` | anyone | The privacy notice for people who send an inquiry. | 1 link. | Version, title, first four sections. | Whole notice on one screen. | **merge** into `/legal/:doc` as one more document | It is a legal text with its own layout, its own version style and no place in the "other documents" list. One template and one list is simpler. The inquiry form's link would point to the new address. | `public/ar/80-privacy-1280-full.png` |
| `/legal/terms` | anyone; linked from `/consent` | Terms of use for account holders. | 5 links. | Version, title, intro, four sections. 1.5 screens. | 1.2 screens. | **keep** | A real text: 8 short sections, dated 2026-10-24. | `public/ar/81-legal-terms-1280.png`, `public/en/81-legal-terms-dark-1280.png` |
| `/legal/privacy` | anyone; linked from `/consent` | Privacy notice for account holders. | 5 links. | Same pattern. 1.4 screens. | 1.1 screens. | **keep** | A real text: 7 sections. | `public/ar/82-legal-privacy-1280.png` |
| `/legal/ai` | anyone; linked from `/consent` | What the AI assistant reads, where it runs, what it never does. | 5 links. | Same pattern. 1.3 screens. | 1 screen. | **keep** | A real text: 6 sections. It states the product rule (the assistant never approves or decides). | `public/ar/83-legal-ai-1280.png` |
| `/legal/data-agreement` | anyone (meant for a client's lawyer) | A template of the data processing agreement. | 5 links. | Title says "(نموذج)", a bold line says the firm's lawyer adapts it. 1.6 screens. | 1.2 screens. | **keep** | A real template with blanks in [brackets], labelled as a template. Whether a contract with blanks should be public is an open question. | `public/ar/84-legal-data-agreement-1280-full.png` |
| `/legal/sub-processors` | anyone (meant for a client's IT and legal teams) | List the outside services that handle data. | 5 links. | Three-row table, fits one screen. | Fits, no overflow. | **keep** | Useful and short. One "in use" badge is not read from real settings (part 2). | `public/ar/85-legal-sub-processors-1280-full.png`, `public/ar/85-legal-sub-processors-768.png` |
| `/legal/security` | anyone (meant for a client's IT team) | Explain how data is protected; show how this site is set up now. | 5 links. | "This site, now" panel with 5 facts, then the first sections. 2.4 screens. | 1.9 screens. | **keep** | The panel reads the real settings and says "development install" where that is true. Longest public page, but it is a reference text. | `public/ar/86-legal-security-1280.png` |
| `/upload/:token` | holder of an upload link mail (no account) | Send one requested document to the firm. | 1 button, 1 file field. Header adds language and "sign in". | "مطلوب من ميزان للاستشارات", the item's name, the file field, Send, the expiry date. | Same. No overflow. | **trim** (the header's "تسجيل الدخول" button and the wordmark's link to the inquiry form) | The best signed-out page: who asks, what for, one action, until when. The person has no account, so "sign in" is noise; guideline 12 says "nothing else". | `public/ar/93-upload-real-link-1280.png`, `public/ar/93-upload-real-link-768.png`, `public/en/93-upload-real-link-dark-1280.png`, `public/ar/90-upload-bad-token-1280.png` |
| Not found (any unknown address; also `/reset-password/x`, `/confirm-email/x`, `/legal/nothing`) | anyone | Say the page does not exist. | 1 link. | Title, one line, "العودة للرئيسية". No wordmark. | Same. | **keep** | Short and plain. For a signed-out visitor "back to overview" leads to sign-in, which is fine. It looks unlike every other signed-out page (no wordmark, no background). | `public/ar/95-not-found-signed-out-1280.png`, `public/ar/30-reset-password-bad-token-1280.png` |

Count: 25 rows. keep 21, trim 2, merge 2, cut 0, replace 0.

---

## 2. Marks

### Who is this from? (the largest gap)

- **The inquiry page never names the firm.** `/inquiry`, both languages. A prospect reads the product name "Selah" and "فريق المكتب" ("the firm's team"). The form asks for a company name, a phone number and a reason, and says "us" throughout, without saying who "us" is. `public/ar/71-inquiry-step1-1280.png`.
- **The privacy notice for inquiries does not name the data controller.** `/privacy`: "الذي يديره مكتب الاستشارات الذي يستخدم صلة" ("run by the consulting firm that uses Selah"). No name, no address, no contact. The six `/legal` texts are the same: "the consulting firm that invited you". `public/ar/80-privacy-1280-full.png`.
- **No mail names a firm or a person.** All five kinds in the mailbox come from "Selah <no-reply@selah.localhost>" with no Reply-To. The upload-link mail goes to someone with no account and says only "طلب منك مستشار عبر صلة إرسال مستند" ("a consultant asked you, through Selah, to send a document"): no firm, no consultant, no document name. It reads like a phishing mail. The invitation template says only "تمت دعوتك إلى صلة" (no organisation, no inviter, no role). `public/mails/upload-link.png`, `public/mails/notes-mails.json`, `apps/web/src/lib/mail-templates.ts`.
- **Only the upload page says who asks**: "مطلوب من ميزان للاستشارات". So the firm's name is available to public pages; the others do not use it. `public/ar/93-upload-real-link-1280.png`.
- **"Reply to this mail" is promised, the mail cannot be replied to.** `/privacy` "حقوقك" says to ask for your data "بالرد على البريد الذي يصلك من المكتب". Step 5 of the form says marketing can be stopped "بالرد على أي بريد من المكتب". The confirmation mail comes from a no-reply address with no Reply-To. `public/mails/inquiry-received.png`.

### Wrong language, RTL, cut-off text

- **No language switch on any sign-in page.** `/sign-in`, `/forgot-password`, `/reset-password`, `/invite`, `/confirm-email`, `/sign-in/link`, `/security`, Not found. Arabic is the default and the language is a cookie. An English reader who opens a link from a mail lands on an Arabic page and has no way to change it. Only `/inquiry`, `/privacy`, `/legal`, `/upload` have the switch. `public/ar/01-sign-in-1280.png`, `public/ar/22-sign-in-link-real-1280.png`.
- **The wordmark is Latin only** ("Selah") on every Arabic page, while the text beside it says "صلة". Two spellings of the Arabic name are in use: "صلة" (sign-in, mails, security) and "صِلَة" (consent, legal). `public/ar/83-legal-ai-1280.png` against `public/ar/22-sign-in-link-real-1280.png`.
- **Version date reads backwards on `/privacy`.** It shows "الإصدار 24-10-2026". The `/legal` pages show "الإصدار 2026-10-24" for the same kind of version. `public/ar/80-privacy-1280-full.png`, `public/ar/81-legal-terms-1280.png`.
- **Addresses written as raw text, with the slash on the wrong end in Arabic.** `/legal/data-agreement` section 6 shows "legal/sub-processors/". The same raw addresses ("/legal/sub-processors", "/privacy") appear in `/legal/privacy` and `/legal/ai`. They are not links. `public/ar/84-legal-data-agreement-1280-full.png`.
- **Upload page, Arabic: the file-type line is scrambled.** The Latin list of extensions inside the Arabic sentence breaks the brackets and moves the dots: "CSV (.pdf .docx … .jpeg" then "(csv. txt.،". `public/ar/93-upload-real-link-1280.png`.
- **Upload page, Arabic: the file button says "Choose File / No file chosen" in English.** It is the browser's own control, so it follows the browser's language, not the page's. `public/ar/93-upload-real-link-1280.png`.
- **Confirmation screen, Arabic: the e-mail address breaks in the middle** ("audit-" on one line, "check@example.test." on the next, with the full stop on the wrong side). `public/ar/76-inquiry-sent-1280.png`.
- **English step name "About you" for a step about the organisation** (Arabic: "عن منشأتك"). `public/en/72-inquiry-step2-1280.png`.
- No horizontal overflow at 1280 or 768 on any captured page. No raw keys. No stray-language labels found by the capture.

### Words a visitor would not understand

- `/sign-in`, under the link button: "لمديري العملاء ومسؤولي الإجراءات. المسؤولون وفريق المكتب يدخلون بكلمة المرور." / "For client managers and action owners. Admins and firm staff sign in with their password." These are Selah's role names. A person does not know which one they are. `public/ar/01-sign-in-1280.png`.
- **Two Arabic names for the same person.** `/sign-in` says "مدير منظمتك"; `/invite`, `/confirm-email`, `/security` and the mails say "مسؤول حسابك". `public/ar/01-sign-in-1280.png`, `public/ar/40-invite-bad-token-1280.png`.
- **"طلب" means two things on public pages.** On `/inquiry` it is the prospect's inquiry ("طلب جديد", "إرسال الطلب"). On `/upload` it is a document request ("هذا الرابط لهذا الطلب وحده", "أُغلق الطلب"). The firm's own mail calls the inquiry "استفسار". `public/ar/71-inquiry-step1-1280.png`, `public/ar/90-upload-bad-token-1280.png`.
- `/inquiry` step 1, Arabic: "اسم المنشأة" has the hint "كما يظهر في السجل التجاري", then a second field "الاسم بالعربية — اختياري، إذا كان مختلفًا عن الاسم أعلاه". An Arabic visitor has already typed the Arabic name. The second field only makes sense on the English page. `public/ar/71-inquiry-step1-1280.png`.
- `/inquiry` step 4 uses consulting terms as questions: "مصفوفة صلاحيات", "ميثاق عائلي", "مجلس عائلي". They are optional and aimed at owners, so this is a small mark.

### Numbers and statements that do not trace to real data, or disagree

- **`/legal/sub-processors`: the mail service "(currently Resend)" is marked "مستخدم في هذا الموقع" always.** The code returns "in use" for the mail row without reading any setting (`inUse()` in `(public)/legal/[doc]/page.tsx`). On this copy mail goes to Mailpit. The other two rows do read the settings. `public/ar/85-legal-sub-processors-1280-full.png`.
- **"Stays in Saudi Arabia" against "may be outside the Kingdom".** The consent card for the privacy notice sums it up as "وأنه يبقى في المملكة" (`owner_at_rawdah.test/ar/001-consent-1280.png`). The sub-processor list of the same site says the mail service holds names, addresses and mail text on servers that "may be outside the Kingdom", and on this copy shows the hosted AI model as in use "خارج المملكة". `public/ar/85-legal-sub-processors-1280-full.png`.
- **"Wait a minute" for a 15-minute lock.** After 10 sign-in tries an account is locked for up to 15 minutes (`src/auth/attempts.ts`). The page says "محاولات كثيرة. انتظر دقيقة ثم حاول مجدداً." The server sends the real waiting time; the page does not use it. Not triggered, read from code.
- **"About five minutes"** on `/inquiry`: not checked against anything. The shortest path is 8 required answers over 5 screens.

### Decoration rather than information

- **The inquiry page's title is typed in letter by letter.** On this copy nothing shows for about 2 seconds, then the title types for about half a second. The first capture in both languages shows one letter ("ح", "T"). It is the one line that says what the page is. `public/ar/70-inquiry-1280.png`, `public/en/70-inquiry-1280.png`, `public/notes-inquiry.json` (`titleTyping`).
- **A green tick on the confirmation screen.** The rule is green only for human-verified work. Nobody has verified anything yet. `public/ar/76-inquiry-sent-1280.png`.
- **A reading-progress bar on pages that fit one screen** (`/legal/sub-processors`): it shows as a full black line under the header. `public/ar/85-legal-sub-processors-768.png`.
- The "what happens next" panel and the title "حدّثنا عن منشأتك" stay beside the confirmation, where the visitor has already told us. `public/ar/76-inquiry-sent-1280.png`.

### Text that explains the screen

- `/sign-in`: the subtitle "الحسابات بدعوة فقط. اطلب من مدير منظمتك دعوتك." stays above the notice "حسابك جاهز" for a person who has just been invited. `public/ar/04-sign-in-done-invited-1280.png`.
- `/forgot-password` after sending: the subtitle still says "سنرسل إليك رابطاً" (future) above "الرابط في طريقه إليك". `public/ar/12-forgot-password-sent-1280.png`.

### More than one solid button

- `/inquiry` steps 2 to 4: a chosen option in a choice row is drawn solid black, like the main button. Step 2 shows three black items in one card ("واتساب", "العربية", "متابعة"). `public/ar/72-inquiry-step2-errors-email-and-phone-1280-full.png`.
- Every other signed-out page has one solid button or none.

### Error states

- **Five dead-link pages, five different behaviours.**
  - Sign-in link: says so and links to sign-in. Good. `public/ar/20-sign-in-link-bad-token-1280.png`, `public/ar/25-sign-in-link-used-twice-1280.png`.
  - Upload: a card that says so and who to ask. Good. `public/ar/90-upload-bad-token-1280.png`.
  - Invitation: says so, then nothing to press. No link to sign-in. `public/ar/40-invite-bad-token-1280.png`.
  - Reset password: a well-formed dead link shows the full form. The person types a new password twice and only then reads "انتهت صلاحية هذا الرابط". A malformed one gets the bare Not found page. `public/ar/34-reset-password-dead-link-after-submit-1280.png`, `public/ar/30-reset-password-bad-token-1280.png`.
  - E-mail change: a well-formed dead link shows the confirm button; the error comes after the press, and the button is then greyed with no way on. `public/ar/52-confirm-email-dead-link-after-press-1280.png`.
- **Nothing reveals whether an account exists.** Wrong password gives "البريد أو كلمة المرور غير صحيحة." for both a known and an unknown address. Forgot-password and the link request give one answer for every address ("إن كان لهذا العنوان حساب فعّال…"). `public/ar/08-sign-in-wrong-password-unknown-address-1280.png`, `public/ar/09-sign-in-wrong-password-known-address-1280.png`, `public/en/12-forgot-password-sent-unknown-address-1280.png`, `public/notes-auth-flows.json`.
- **Two styles of validation.** The inquiry form shows its own red lines in the page's language. Sign-in, forgot-password, reset-password and upload rely on the browser's own bubble for empty or short fields, which is in the browser's language and wording ("استخدم 12 أحرف على الأقل."). `public/notes-auth-flows.json`.
- **The review step leaves out three answers**: the free message ("هل هناك ما تودّ إضافته؟"), the preferred language and "كيف عرفت عنّا؟". The visitor cannot check them before sending. `public/ar/75-inquiry-step5-review-1280.png`.

### Console errors and what the pages carry

- **Hydration error on `/sign-in/link/:token`, every load, both languages**: "Hydration failed because the server rendered HTML didn't match the client", with "Encountered a script tag while rendering React component". Seen with a real and a made-up token. `public/ar/pages.json` records `21-sign-in-link-wellformed-fake` and `22-sign-in-link-real`; `public/ar/21-sign-in-link-wellformed-fake-1280.png` (badge "2 Issues").
- The same "script tag" console error shows on the Not found page reached through `/reset-password/x`, `/confirm-email/x`, `/legal/nothing`.
- **Sign-in, inquiry, privacy and legal pages send the app's whole text catalogue to the visitor.** `/sign-in` is 265 KB of HTML and its source contains the firm's internal wording ("Mark as triaged", conflict check, staffing). `/upload/:token` is 31 KB because it passes only its own strings, as its code comment says a public page should. Guideline 12: "no internal wording on public pages". Not visible on screen; visible in the page source. Code: `(auth)/layout.tsx`, `(public)/inquiry/layout.tsx`, `(public)/legal/layout.tsx`.
- Browser tab titles: every sign-in page is titled just "صلة". Public pages have their own titles. `/inquiry` is titled "تواصل معنا" / "Work with us".
- `/upload/:token` has no main heading for a screen reader (the item's name is not a heading).

### Keyboard

- **Sign-in: fully usable with the keyboard, focus ring visible on every stop.** Tab order: e-mail, "نسيتها؟", password, "دخول", link button, "أرسل طلبًا". The "forgot it?" link sits between the two fields, so it takes two Tab presses to get from e-mail to password. Enter in the password field signs in. `public/ar/07-sign-in-keyboard-focus-1280.png`, `public/notes-auth-flows.json`.
- **Inquiry: every control can be operated with the keyboard**, in Arabic and English: lists open with Enter and move with the arrows, choice rows move with the arrows in the right direction for RTL, Space ticks boxes, Enter in a text field goes to the next step. `public/notes-inquiry.json`, `public/notes-choice-row-keys.json`.
- **Focus is lost between steps.** Steps 1 and 2 put the cursor in the first field. On steps 3, 4 and 5 the focus stays on the Continue button at the bottom, so a keyboard user must go backwards through the whole step. After sending, the focus drops to nothing. `public/notes-inquiry-keyboard.json` (`focusOnArrivalStep3` to `5`, `focusAfterSending`).
- **Four buttons all named "تعديل"** on the review step, with nothing to tell them apart for a screen reader. From the top of the page it takes 13 Tab presses to reach the consent tick. `public/notes-inquiry.json` (`toConsent`).
- Upload page: wordmark, language, sign in, file, send. Three stops before the only thing the person came for.

### Hard rules checked and found clean

- **No real consulting firm is named anywhere.** The two spellings given in my task were searched in all 11 mail bodies, in both message files, in the mail templates and in every captured page record: 0 hits. Only "Selah / صلة" appears in mails; "ميزان للاستشارات / Mizan Advisory" appears once, on the upload page. `public/mails/notes-mails.json`.
- **Selah does not do the consulting on these pages.** The six yes/no questions on the inquiry form are answers the prospect gives; nothing is scored or judged on screen.
- **No pretend content.** The legal texts are real texts, not placeholders (details in part 5, question 5). No "coming soon".
- No client data or staff names on any public page.
- **English dark mode** (sign-in, inquiry, upload, terms): readable, nothing left in light colours. `public/en/01-sign-in-dark-1280.png`, `public/en/70-inquiry-dark-1280.png`, `public/en/93-upload-real-link-dark-1280.png`, `public/en/81-legal-terms-dark-1280.png`.

---

## 3. The 18 findings and the batch 0 bugs, for these pages

Most of the 18 concern signed-in screens. The ones that touch this area:

- **U05 (five ways to send a file): partly true here.** The no-login upload link is still one of the ways. Its own page is the simplest of them: one item, one file field. `public/ar/93-upload-real-link-1280.png`. The count of ways is for the helper who covers the Requests tab.
- **U10 (status words, one Arabic word for several things): partly true.** No statuses here, but the same kind of drift: "طلب" for both an inquiry and a document request; "مدير منظمتك" and "مسؤول حسابك" for one person; "صلة" and "صِلَة". Evidence in part 2.
- **U11 / U12 (firm machinery and vocabulary on client screens): partly true.** On screen: Selah's role names on the sign-in page. In the page source: the firm's whole vocabulary is sent to every signed-out visitor. The inquiry page's mention of a conflict-of-interest check is plain and honest and should stay. `public/ar/01-sign-in-1280.png`.
- **U16 (inquiry page with five cards): not in this area.** That is the firm's page for an inquiry. The public form that feeds it has one clear next step per screen.
- **U01–U04, U06–U09, U13–U15, U17, U18: do not apply** to signed-out pages.

Batch 0 bugs:

- **"A hydration error on the meeting page": the same kind of error is still present on `/sign-in/link/:token`.** `public/ar/21-sign-in-link-wellformed-fake-1280.png`. (I did not check the meeting page.)
- Raw status keys, three percentages, the reminder ladder, the departments switch: do not apply here. No raw keys were found on any signed-out page.

---

## 4. Proposed target: the paths, page by page

There is no sidebar and no tab row on these pages. Instead, the three paths a newcomer takes.

### A new invited user

Today (from the code and the captured states; the valid invitation page was not captured):

1. **Mail** "دعوة للانضمام إلى صلة | You're invited to Selah". Says "تمت دعوتك إلى صلة" and "the link works for 7 days". Two buttons (one per language) and the raw address. No organisation, no inviter, no role.
2. **`/invite/:token`**: "انضم إلى {org}", "دُعيت بصفة {role}". Confirm the name, type a new password twice. Arabic only unless the cookie says otherwise; no switch.
3. **`/sign-in?done=invited`**: "حسابك جاهز. سجّل الدخول بكلمة المرور الجديدة." Type the e-mail and the password again.
4. **`/security`**, only where two-step sign-in is required for the role: type the password a third time, scan the code, type 6 digits, save the backup codes.
5. **`/consent`**: three ticks, "قبول ومتابعة".
6. Home.

That is 4 or 5 pages after the mail, and the password typed 2 or 3 times within a few minutes.

Where it could be shorter, without adding anything:

| Today | Target |
|---|---|
| Mail names nothing | Mail names the organisation and the role, as the page it opens already does |
| `/invite` → `/sign-in` (type both again) → next | `/invite` signs the person in and goes straight on. The sign-in page and its "your account is ready" notice drop out of this path |
| `/security` (where the role requires it) asks for the password a third time | Keep the page. Whether the password just chosen can count is a security decision, not a layout one |
| `/consent` as its own page | Keep. It must also show again when a text changes |
| No language switch on steps 2 to 4 | The same switch the public pages have |

A client manager or an action owner can afterwards sign in by link: mail → `/sign-in/link/:token` → one button → home (`public/ar/24-after-sign-in-link-1280.png`). That path is already as short as it can be. They still have to choose a 12-character password at step 2 that they may never use (open question 3).

### A new prospect

Today:

1. **`/sign-in`** ("لا تتعامل معنا بعد؟ أرسل طلبًا") or a direct link to **`/inquiry`**.
2. Step 1 organisation (2 required answers).
3. Step 2 contact (3 required).
4. Step 3 need (2 required).
5. Step 4 optional context (0 required).
6. Step 5 review and consent (1 required).
7. Confirmation with a reference.
8. Mail "استلمنا طلبك" with the same reference.
9. Later, if the firm agrees: the invitation mail, then the invited-user path above.

That is 8 required answers over 5 screens and 4 presses of Continue.

| Today's steps | Target steps |
|---|---|
| 1 المنشأة · 2 بيانات التواصل · 3 ما تحتاجه · 4 عن منشأتك · 5 المراجعة | 1 أنت ومنشأتك (today's 1 and 2, without "الاسم بالعربية" and "المسمى الوظيفي") · 2 ما تحتاجه · 3 عن منشأتك (optional) · 4 المراجعة |

Where each dropped thing lives: the Arabic name and the job title are optional and the firm can ask them in the discovery call; nothing else is removed.

### A person sent an upload link (no account)

Mail → `/upload/:token` → choose a file → Send → "وصل الملف. شكراً لك." One page. Nothing to shorten. The mail is the weak part (it names nobody).

### What these people visibly lack today

- A language switch on the sign-in pages.
- The firm's name on the inquiry page, the privacy notice and the mails.
- A way forward from the dead invitation page.
- A reply address on the mails that tell them to reply.
- Their own free message, language and "how did you hear" on the review step.

---

## 5. Open questions

1. **Should the inquiry page, the privacy notices and the mails show the firm's name**, as the upload page already does? Rule 5 keeps the real firm out of the product, but a prospect and a document sender need to know who they are dealing with, and a privacy notice normally names who holds the data.
2. **May accepting an invitation sign the person in directly**, instead of sending them to the sign-in page to type the same password again?
3. **Do client managers and action owners need to choose a password at all** when they are invited, given that they can sign in by link?
4. **Should mails follow the person's language** (the inquiry form asks for it) or stay two-language with two buttons?
5. **The legal texts are real but short, and written without a named firm or contact.** Has a lawyer read them? Should the data agreement template, with its blanks, be public?
6. **Keep the six yes/no questions on the public form** ("ما لدى منشأتك حاليًا"), or leave them for the discovery call? They make step 4 the longest screen.
7. **The mail row of the sub-processor list**: should "in use" follow the real mail setting, like the other two rows?
8. **The upload link made for this audit** (to `audit-check@example.test`, valid to 23 Nov 2026) and the test inquiry INQ-A90915D0 are still on the review copy. Remove them or leave them?
