# Scenario 31. Team load, expertise, and the second reviewer (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010), 23 Nov 2026, Arabic desktop 1280 px. English not run. Evidence is outside the repo at `C:\Projects\selah-scenario-shots\31\` (screenshots; `results.json` in `31\a\` to `31\h\`). Page times are the development server and say nothing about production.

**How it was driven.** A headless browser script (Playwright, outside the repo) for the screens; same-origin `fetch` for "should be denied" checks.

**Shortcuts that are not user actions.**
1. **An accident that did real work:** while probing, my first script sent `POST /api/actions/<id>/transition {"to":"verified_complete"}` as Noura on the seeded action «عرض المسودة على المجلس واعتمادها» (first sign-off already given by Omar in the seed). Noura is an eligible second signer, so the call **succeeded**: the action is now «تم التحقق». That is the second sign-off and verification done by a direct call, not by the button. The full flow was then run on the screens on a second action (steps 3 to 7).
2. For the second action's evidence I set the state up through the screens (Abdullah sent the revised file with the dialog); the uploaded file is a test `.docx` made by a script.
3. Expertise for Omar was changed by Sara (services and sectors) with a direct call to the profile route, the same one the screen uses.

**Roles.** Sara (firm admin), Khalid (lead), Noura (deputy), Omar (consultant, first signer), Layla (observer), Majed (firm, not on Al-Nukhba), Abdullah (action owner), Fahd and Reem (Al-Nukhba client), Hind (Rawdah).

**PRIVACY findings: none.**

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Sara | Open `/team`: the team-load table | Reviews and work per consultant, not a ranking | PASS | `31\team\peek-01.png` (taken after steps 3 to 7) | Section «الفريق، آخر 90 يوماً» (reviews done, median review days, waiting, late) and the table «عبء العمل: مرتب حسب الاسم. لقرارات التوزيع، وليس تقييماً.» Columns: clients, open projects, to review, oldest wait, second signatures, late, due in 7 days, due in 30 days. It is sorted by name. Two figures were cross-checked: at the start Khalid's «متأخرة 3» matched the project page's «3 إجراءات متأخرة», and after the late action «إعداد لائحة عمل اللجنة» was verified (step 7) his figure fell to 2. The other figures were not checked. |
| 2 | Khalid, Omar, Layla, Fahd | Open `/team` | No load table for non-admins | PASS | `31\f\results.json`, `31\f-lead-team.png`, `31\f-consultant-team.png` (the file names are the account name before the @ plus the path) | Firm consultants see a plain list (name, e-mail, role, project count); the table «عبء العمل» is only on Sara's page. Fahd sees his own company's people page. |
| 3 | Abdullah | Send the revised file for the revision-requested action «إعداد لائحة عمل اللجنة» (priority critical, so the client's rule asks for two sign-offs) | Awaiting review; the page says two sign-offs are needed | PASS | `31\b-send-dialog.png`, `31\b-send-filled.png`, `31\b-sent.png` | The dialog makes the owner pick which evidence item the file answers (even with one item). After sending: «بانتظار المراجعة ... ويتحقق منه مستشار ثانٍ أيضًا.» |
| 4 | Omar | Press **اعتماد (الأول من اثنين)** before accepting the evidence item | Refused with the reason | PASS with friction | `31\d\results.json` | `409 {"message":"every evidence request must be accepted or waived first"}` — in **English**, on an Arabic screen; nothing on the page tells him which item is open (known: accepting and signing are two steps). |
| 5 | Omar | Press **قبول** on the evidence item, then **اعتماد (الأول من اثنين)** | First sign-off recorded | PASS | `31\e-accept-after.png`, `31\e-omar-dialog.png`, `31\d2\results.json` | **قبول** acts at once, no confirm; the item reads «مقبول». The sign-off dialog: «يبقى الإجراء بانتظار المراجعة. يراجع مستشار آخر في الفريق الأدلة نفسها ...» and an optional note for the second reviewer. After: «يراجعه مستشار آخر: خالد الشمري ونورة القحطاني. تم اعتماد واحد من اثنين. اعتُمد بواسطة عمر الزهراني ...» and Omar has no sign-off or verify button. |
| 6 | Omar | The first signer tries to verify; and to sign off again | Refused | PASS | `31\d2\results.json` | Verify: `404 {"error":"not_found"}` (he is not on the eligible list); sign-off again: `409 {"message":"this round already has its first sign-off"}` (English). |
| 7 | Noura | Open the action; press **الاعتماد الثاني والتحقق** and confirm | The action becomes verified; the owner is told | PASS | `31\d-noura-dialog.png`, `31\d-noura-after.png` | Dialog: «أنت المستشار الثاني الذي يراجع هذه الأدلة. يصبح الإجراء «تم التحقق من الإنجاز» ويُبلَّغ المكلَّف به.» After: «تم التحقق». |
| 8 | Sara | Al-Nukhba → Setup → **الاعتماد الثاني للأدلة** → **تغيير** → «كل إجراء», then back to «الأعمال ذات الأولوية العالية» | Rule changes; the card says who and when | PASS | `31\h-rule-dialog.png`, `31\h-rule-all.png`, `31\h\results.json` | Four choices: one review / after two revisions / high priority (current) / every action. The dialog says the one who gave the evidence, the owner and the first reviewer can never give the second. Card: «كل إجراء ... يحتاج إلى اعتمادين. غُيّر بواسطة سارة العتيبي في 23/11/2026». Put back to the original. |
| 9 | Omar | `/team/expertise`: his own row | He can set his languages and availability, not services | PASS (retest of scenario 1, step 13) | `31\g-omar-expertise.png`, `31\g\results.json` | The page now says «يسجّل مدير المكتب الخدمات والقطاعات، وتحدد أنت لغاتك ومدى توفرك.» Omar's own row has an edit button; the other four rows have none. `PUT .../profile {languages, acceptingNewClients:false}` → `200 {"ok":true}`; services → `404`. Scenario 1 found "a consultant cannot set his own expertise" and that the page claimed he could: **the page and the control now agree** (the services stay with the admin). |
| 10 | Sara | The same page: edit Omar's services and sectors | Saved | PASS | `31\g-sara-expertise.png` | `PUT .../profile` → `200`; Sara has an edit button on every row. (I left Omar's services as «الهيكل التنظيمي، مصفوفة الصلاحيات» and sector «retail».) |

**Should be denied checks (account, what was asked, what came back).** Action `ff128e3a-3ec5-4d62-a53d-9c08141ef986` (while awaiting review, first sign-off not yet given); Al-Nukhba client `530fbdcc-cec8-4a99-8ba4-58ca95f2a7c2`; 23 Nov 2026, as the signed-in account.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | admin@nukhba.test (Fahd), manager@nukhba.test (Reem), owner@nukhba.test (Abdullah, the owner), observer@mizan.test (Layla), lead2@mizan.test (Majed), admin@rawdah.test (Hind) | `POST /api/actions/<id>/sign-off` | `404 {"error":"not_found"}` for all six Valid only while the action awaits review; state is checked after read access. |
| D2 | the same six | `POST /api/actions/<id>/transition {"to":"verified_complete"}` | `404` for all six |
| D3 | the same six | `PUT /api/actions/<id>/second-review {"on":false}` (drop the second sign-off) | `404` for all six |
| D4 | consultant@mizan.test (Omar, the first signer) | `POST .../transition` to verified_complete | `404` (after his sign-off; before it: `400 "this work needs two sign-offs; sign off first"`) |
| D4 | the same | `POST .../sign-off` again | `409 "this round already has its first sign-off"` |
| D6 | consultant@mizan.test (Omar), observer@mizan.test, admin@nukhba.test, lead2@mizan.test, admin@rawdah.test | `PUT /api/orgs/<Al-Nukhba>/second-review {"rule":"off"}` | `404` for all five (only the firm admin, or the client's lead or deputy, may) |
| D7 | consultant@mizan.test (Omar) | `PUT /api/consultants/<Omar>/profile {"services":[...]}` | `404` (the admin's field) |
| D7 | consultant@mizan.test | `PUT /api/consultants/<Khalid>/profile {"acceptingNewClients":true}` | `404` |
| D7 | admin@nukhba.test, observer@mizan.test | `PUT /api/consultants/<Khalid>/profile` | `404` both; Fahd's `GET /api/consultants` → `404` (Layla's → `200`, a firm account) |

Not run: the firm admin (Sara, who is not on the eligible list) trying the second step while an action really awaits it (my probe came after the action was already verified, so it proves nothing); the rule "after two revisions" in a real two-round case; the second reviewer being told when the first signs (Khalid's and Noura's bell and mail were not read); a second sign-off on a firm-run client; asking for a second sign-off on one action by hand (**PUT .../second-review {"on":true}** from the screen); the team-load table in English; checking the other load figures against the data.

Console and server errors: not collected.

## Confusions
- The reason for a refused first sign-off arrives as an English sentence and does not name the open evidence item.
- **قبول** on an evidence item acts at once with no confirm and no undo shown.
- A person who is not on the eligible list gets "not found" for the second step, not "you cannot give it".
- Two lists of consultants (team page, expertise page) show different columns; the load table is on the first only.

## Four plain-words answers
1. Mostly. Accept the item first, then sign; the message that says so is English.
2. Nothing leaked and nothing broke. Nobody on the client side, no observer and no outsider can sign off.
3. No.
4. Show the open evidence item on the first-sign-off screen, in Arabic.
