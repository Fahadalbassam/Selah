# Scenario 28. Getting in: invitation, first sign-in, forgotten password, sign-in link, lock-out, two-step (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010, mail http://localhost:8035), 23 Nov 2026, Arabic desktop 1280 px. **English was not run** for these screens (they use the same message files; not checked). Evidence is outside the repo at `C:\Projects\selah-scenario-shots\28\` (screenshots; `results.json` in the folders `28\a\` to `28\n\`; `omar-2fa.json` holds the test key and backup codes of a local test account). Page times are the development server and say nothing about production.

**What could not be run.** A **real authenticator app or device**. Two-step setup was done with a six-digit code computed by a small script from the key the screen shows (the same maths an app does); that stands in for the phone. Also not run: sign-in from a second device, the "lost my authenticator" reset by the admin, and a signed-out e-mail change. **Two-step sign-in is not enforced on this copy**: firm admins, consultants and client admins sign in with a password alone here (the server setting that makes it required is off in local mode), so "required for these roles" was not tested.

**How it was driven.** A headless browser script (Playwright, outside the repo) for every screen; mail read from Mailpit's API; `psql` read-only for the consent and audit rows.

**Shortcuts that are not user actions.** (1) The six-digit code was computed by script, as above. (2) The password-guess attempts for the lock-out (step 7) were `fetch` calls to the sign-in endpoint, not typed. (3) An accident: Khalid's account was locked for 15 minutes early in the run after about 12 sign-ins by the test script (see scenario 22); it cleared by itself.

**Roles.** Hind (Rawdah client admin, invites), a new person Nour (client manager, invited here), a signed-out visitor, Sara (firm admin), Omar (consultant, two-step), finance@nukhba.test (the lock-out target).

**PRIVACY findings: none.** Nobody got in with a refused method, and the forgotten-password and sign-in-link screens say the same thing for an address that has no account.

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Hind | `/team` → **دعوة شخص** with an address outside the company's allowed domain (`nour@outside-example.test`) | Refused, with the reason | FAIL (logic) | `28\b-invite-wrong-domain.png`, `28\b-invite-dialog.png` | The server refused it (`409 "that address is not on the organisation's email domains"`) but the dialog says «تم ذلك مسبقاً أو غيّره شخص آخر. أعد التحميل لرؤية آخر حالة.» ("already done or changed by someone else. Reload"). The person is not told that the domain is the problem. |
| 2 | Hind | The same with `nour@rawdah.test`, role «مدير لدى العميل» | Invitation made; mail sent | PASS | `28\b-invite-sent.png`, Mailpit | `201` with an expiry 7 days out. The mail «دعوة للانضمام إلى صلة \| You're invited to Selah» arrived at once (security mail is not held). It says «تمت دعوتك إلى صلة. الرابط صالح لمدة 7 أيام.» and does not name the firm or the inviter (known gap). The list then reads «دعوة مفتوحة واحدة». |
| 3 | Nour | Open the invitation link signed out; password and confirm differ | Message | PASS | `28\c-mismatch.png` | «كلمتا المرور غير متطابقتين.» |
| 4 | Nour | A password of 7 characters (`Short1!`) | Refused with the 12-character rule | PASS with friction | `28\c-short-password.png`, `28\g-short.png` | The page keeps the form and the hint «من 12 إلى 128 حرفاً»; no request is sent and no error line was captured (it may be the browser's own tooltip, which a headless run cannot show). Same on the reset page. |
| 5 | Nour | A valid password | Account created, sent to sign-in | PASS with friction | `28\c-created2.png` | `POST .../accept` 200 after about 10 s on the dev server (the first click looked dead at 5 s). Lands on `/sign-in?done=invited`: «حسابك جاهز. سجّل الدخول بكلمة المرور الجديدة.» |
| 6 | Nour | Sign in for the first time | The three notices, then in | PASS | `28\d-first-signin.png`, `28\e-two-ticked.png`, `28\e-three-ticked.png`, `28\e-home-after-consent.png` | `/consent`: terms, privacy notice, AI notice, each with «اقرأها كاملة (الإصدار 2026-10-24)» and a tick box. **قبول ومتابعة** stays disabled until all three are ticked (checked with none and with two). After accepting, three rows (`terms`, `privacy`, `ai_notice`, version 2026-10-24) are stored and she lands on Home. |
| 7 | signed out | Forgotten password for Nour's address, and for an address with no account | The same message both times | PASS | `28\f-forgot.png`, `28\f-forgot-sent.png`, `28\f\results.json` | Both: «إن كان لهذا العنوان حساب فعّال فالرابط في طريقه إليك. وهو صالح لمدة ساعة.» One reset mail to Nour (subject «إعادة تعيين كلمة المرور \| Reset your password»), none to the unknown address. |
| 8 | Nour | Use the reset link; set a new password | Password changed; sent to sign-in | PASS | `28\g-reset-page.png`, `28\g-reset-done.png` | Page says «سيُسجَّل الخروج من كل الأجهزة.» After: «تغيّرت كلمة المرور. سجّل الدخول بالجديدة.» A mail «تغيّرت كلمة مرورك \| Your password was changed» followed. |
| 9 | Nour | The old password after the reset; the new one | Old refused, new works | PASS | `28\g\results.json` | Old: `401`. New: `200`, lands on Home. |
| 10 | signed out | The same reset link a second time | Refused | PASS | `28\g-reuse.png` | «هذا الرابط لا يعمل. انتهت صلاحيته أو استُخدم من قبل.» A direct reset with the used token: `400 {"message":"Invalid token","code":"INVALID_TOKEN"}`. |
| 11 | Nour (client manager) | Sign-in page → **أرسل لي رابط الدخول بالبريد** | A one-time link by mail | PASS | `28\h-link-form-nour.png`, `28\h-link-sent.png` | «إن كان هذا العنوان يستطيع الدخول برابط فالرابط في طريقه إليك. يعمل مرة واحدة خلال 15 دقيقة.» Mail «رابط الدخول إلى صلة \| Your Selah sign-in link»: «الرابط صالح لمدة 15 دقيقة ولمرة واحدة.» The link opens a page with one button («تسجيل الدخول»), so a mail scanner that opens the link does not use it up. |
| 12 | Nour | Press the button | Signed in | PASS | `28\i-link-first-use.png` | Lands on Home. |
| 13 | signed out | Press the button on the same link again | Refused | PASS | `28\i-link-second-use.png` | `/sign-in?error=INVALID_TOKEN`: «انتهت صلاحية رابط الدخول أو استُخدم من قبل. اطلب رابطاً جديداً، أو ادخل بكلمة المرور.» |
| 14 | finance@nukhba.test | Ten wrong passwords, then the eleventh, then the right one | Locked after ten, even for the right password | PASS | `28\j-locked-screen.png`, `28\j\results.json` | Attempts 1 to 10: `401 INVALID_EMAIL_OR_PASSWORD`. 11 and 12: `429 {"message":"too many sign-in attempts"}`. The right password while locked: `429`. The sign-in page says «محاولات كثيرة. حاول مجدداً بعد 15 دقيقة.» The audit log has `auth.sign_in.failed` (10) and `auth.sign_in.locked` (`{"knownAccount": true}`). The message does not say how to get help. |
| 15 | Omar | `/security` → password → key shown → a wrong code, then the right one | Two-step on; backup codes shown once | PASS | `28\k-setup.png`, `28\l-wrong-code.png`, `28\l-enabled.png` | Screen: «امسح هذا الرمز ... لا يمكنك المسح؟ اكتب هذا المفتاح في التطبيق: <key>.» Wrong code: `401 INVALID_CODE`; the right code: `200`; then «التحقق مفعّل الآن. احفظ هذه الرموز الاحتياطية ... لن تظهر مرة أخرى.» with 10 codes. The setup response already carries the key and the ten codes before the code is verified (visible in the browser's network list). |
| 16 | Omar | Sign out and in: password, then a wrong code, then the right code | The code is asked for; nothing opens before it | PASS | `28\m-code-prompt.png`, `28\m-wrong-code.png`, `28\m-signed-in.png` | After the password: `{"twoFactorRedirect":true,"twoFactorMethods":["totp"]}` and the page «الرمز من تطبيق المصادقة» with a link «استخدم رمزاً احتياطياً بدلاً من ذلك». Wrong code: «لم يعمل هذا الرمز. جرّب أحدث رمز.» Right code: Home. |
| 17 | Omar | A backup code, then the same code again | Works once | PASS | `28\n\results.json` | First use `200`; second use `401 {"message":"Invalid backup code","code":"INVALID_BACKUP_CODE"}`; a different code `200`. |

**Should be denied checks (account, what was asked, what came back).** 23 Nov 2026.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | Hind (Rawdah admin) | Invite an address outside the allowed domain | `409 {"error":"conflict","message":"that address is not on the organisation's email domains"}` (dialog text misleading, step 1) This is a rule check, not access control. |
| D2 | nour@rawdah.test **before** accepting the notices | Open `/`, `/projects`, `/actions`, `/assistant`, `/team` | Each page ends on `/consent` (HTTP 200 with the notices page) |
| D2 | the same | `GET /api/actions/export?lang=ar` and `POST /api/assistant/query` | `403 {"error":"consent_required"}` for both |
| D3 | signed out | Forgotten password for an address with no account | The same message as for a real account; no mail (Mailpit) |
| D4 | admin@mizan.test (Sara, firm admin) | Ask for a sign-in link on the sign-in page | The same screen message as for Nour; **no mail** (Mailpit has none for Sara); the audit log has `auth.sign_in_link.refused` |
| D4 | an address with no account | same | same message, no mail |
| D5 | signed out | Use a sign-in link, a reset link, a backup code a second time | `INVALID_TOKEN` page; `400 INVALID_TOKEN`; `401 INVALID_BACKUP_CODE` |
| D6 | signed out | The right password for a locked account (finance@nukhba.test) | `429 {"message":"too many sign-in attempts"}` |
| D7 | consultant@mizan.test (Omar) with only the password, no code | Open `/projects`; `GET /api/actions/export?lang=ar` | `/sign-in`; `401 {"error":"unauthenticated"}` |

Not run: see the top. Also not run: a second client admin's two-step reset by Sara; the 5-tries-a-minute limit on the two-step code; three reset links in an hour; the access review mail.

Console and server errors: not collected. The account `finance@nukhba.test` is locked for 15 minutes after step 14; Omar now has two-step on (his saved session still works).

## Confusions
- A refused domain is reported as «تم ذلك مسبقاً أو غيّره شخص آخر».
- The short-password refusal shows no sentence (headless run); the first click on **إنشاء حسابي** looks dead on the dev server.
- The lock-out message does not say where to get help; there is no way to unlock except to wait.
- The two-step setup response carries the key and the backup codes before the first code is verified.

## Four plain-words answers
1. Yes, except the invitation to a wrong domain, which gives a wrong reason.
2. Nothing leaked and nothing broke. The lock-out and the one-use links hold.
3. No.
4. Say "this address is not on your company's e-mail list" in the invitation dialog.
