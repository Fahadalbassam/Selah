# Accounts

Who belongs to an organisation, and how people are invited, re-addressed, switched off, reviewed and erased. Migrations 0020 (tables) and 0021 (rules). Every rule below is enforced in Postgres; the services in `src/services/accounts.ts` and `src/services/onboarding.ts` give clear errors and keep the audit trail.

People sign in with their own address. Selah never issues mailboxes. Each person has one membership (`org_memberships.user_id` is unique), and addresses are unique whatever their case (`user_email_lower_uq`).

## Email domains

`organizations.allowed_email_domains` lists the domains its people must use, lowercase and without "@".

- **The firm** must set its domains before it can invite anyone, and every firm address must match them.
- **A client** with no list accepts any address, because many family firms have no company domain. Once a client sets a list, new invitations and address changes must match it. People already on another address keep their account, and the people list flags free-mail addresses with `personalEmail` so the admin can see them.
- `PUT /api/orgs/:id/email-domains` sets the list.

## Invitations

`POST /api/orgs/:id/invitations` (firm admin anywhere the firm works, client admin in their own organisation) invites one address in one role.

- Only a hash of the link's token is stored. The link is mailed to the invited address and is never returned by the API.
- The invitation expires after 7 days, and an address can have only one open invitation. It is refused for an address that already has an account, or for a role that does not belong in that kind of organisation.
- `GET /api/invite/:token` (public) shows who is invited where. `POST /api/invite/:token/accept` (public) takes a name and a password of 12 to 128 characters, creates the account with the invited address marked verified, and joins the organisation. If joining fails, the new account is removed again.
- `DELETE /api/invitations/:id` revokes an open invitation. That is the only change allowed.

## Address changes

Only the person's admin changes an address: the firm admin for anyone, a client admin for the others in their organisation except fellow admins. Nobody changes their own.

`POST /api/people/:id/email-change` checks the new address against the domains and existing accounts, then mails a confirmation link to it (valid for 2 days). `POST /api/email-change/confirm` (public) switches the account over, ends all its sessions, mails a notice to the old address, and writes the audit log.

## Switching accounts off

`PATCH /api/people/:id` with `active: false` needs a reason. It records who did it and when, ends the person's sessions in the same transaction, and writes the audit log. Nobody can switch off their own account. Switching back on clears the record, and is logged too. Nothing is deleted, and history keeps the person's name.

## Access reviews

Without single sign-on, a client's own offboarding never reaches Selah, so every `firm_settings.access_review_days` (90 by default) each organisation's admins are asked: "Are these people still with you?" A client with no active admin falls to the firm's admins.

- `POST /api/orgs/:id/access-reviews` switches off the people named, each with a reason, and records the review over everyone else, who stay. The database refuses a review that leaves out an active member.
- `app_notify_access_reviews(today)` sends the reminder once per period, in the app and by mail. It is meant to run daily as the schema owner.

## Contacts without a login

`client_contacts` holds the people at a client the firm deals with who have no account, for consultant-managed engagements (action owners by name, meeting invitees). Only the firm admin and the consultants on that client's team can see or change them (`/api/clients/:id/contacts`, `/api/contacts/:id`). Clients never see them.

## Erasure

`POST /api/people/:id/erase` (firm admin only, never yourself) answers a PDPL erasure request through `app_erase_user()`:

- The name becomes "Former user #n" and the address becomes a reserved placeholder.
- The password, sessions and 2FA secrets are deleted, and the membership is switched off.
- Invitations, address changes and queued mail that held the person's addresses are removed.

Every id stays, so audit rows and history still hold together. The erasure itself is logged with its reason. It cannot be undone.

## Two-factor sign-in

Firm admins, consultants and client admins must sign in with a code from an authenticator app (TOTP, Better Auth's two-factor plugin). Client managers and action owners may turn it on for themselves.

- **Until it is on**, those roles can open nothing but `/security`: pages redirect there and API routes answer 403 `two_factor_required` (`src/server/http.ts`, `page.ts`).
- **Setting it up** (`/security`): confirm the password, scan the QR code (or type the key), and type a code to prove it works. Only then is it switched on. Ten backup codes are shown once; each signs in once. New ones can be made later with the password.
- **Signing in** asks for the code after the password, or a backup code. Wrong codes are limited to 5 a minute, and Better Auth locks the account after 10 failures in a row.
- **Switching it off** is refused for the required roles, by a Better Auth hook and by a database trigger (`two_factor_stays_on`).
- **A lost phone:** the person's admin resets it from the team page (`POST /api/people/:id/two-factor-reset`, with a reason). Who may do this follows the address-change rule: the firm admin for anyone, a client admin for their own people except fellow admins, nobody for themselves. The reset removes the secret, ends every session, mails the person, and is audited. They set it up again at the next sign-in.
- Admins see who has it on (`app_two_factor_status`). The app role cannot read the flag directly.
- `TWO_FACTOR_REQUIRED=false` switches enforcement off for local development; production refuses to start with it.

## Password reset

"Forgot it?" on the sign-in page (`/forgot-password`) asks Better Auth for a reset link.

- The answer is the same whether or not the address has an account. Better Auth calls `app_queue_password_reset()`, which only the auth role may run. It queues the link only for someone with an active membership in an active organisation, so switched-off and erased accounts get nothing.
- At most three reset mails reach an address in an hour, and a newer request replaces an unsent link. Better Auth also limits requests to three a minute per IP.
- The link (`/reset-password/:token`) works once, for one hour. Saving a new password ends every session, mails a notice to the address, and writes `password.reset` to the audit log. Two-factor sign-in still applies afterwards.

## Mail

`outbound_emails` is a queue of links only, never content: the reader signs in to see anything. Only database functions write to it, so no app bug can send mail to an arbitrary address. The kinds are invitation, address-change confirmation and notice, access review due, meeting invite and cancellation, password reset and its notice, two-factor reset, new inquiry, and the action events below.

**Action events** (migration 0051): an action's owner gets a mail when the action is released or handed to them, sent back for revision, verified, or given a new item of evidence to send. The mail follows the in-app notification: a trigger on `notifications` queues it only when the notice matches the action as it stands (the person is its owner and it is in that state), only for someone still active, and at most once an hour per person, action and event (`notifications.mailed_at`). It carries a line and a link to `/actions/:id`, never the action's title. Owners named only by name (consultant-managed clients) have no address and get nothing; their reminders go to the lead consultant.

**The sender** (`npm run job:mail`, as the schema owner; `src/jobs/mail.ts`) sends each mail in Arabic, then English, because the queue doesn't know the reader's language.

- It joins the link to `APP_URL` and clears the link once the mail is sent, so tokens don't stay in the database.
- Meeting mails carry the `.ics` built when the mail is sent, so an invite queued before a change goes out with the new time.
- Rows are claimed with `SKIP LOCKED`, so two senders never send the same mail. A failure is retried after 1, 5 and 15 minutes, then 1, 3, 6 and 12 hours, with the error kept in `last_error`. After 8 tries the row is marked `failed_at`.
- With `--watch` it runs as a service: it wakes on each new mail (`LISTEN outbound_email`) and checks every 30 seconds for retries. `docker compose` runs it as the `mail` service.
- `SMTP_URL` (e.g. `smtps://user:password@mail.example.com:465`) and `MAIL_FROM` set the relay. Without `SMTP_URL`, in development only, mails are printed instead of sent.

**Pages the mails link to:** `/invite/:token` (create the account), `/confirm-email/:token` (a button, because mail scanners open links), `/reset-password/:token`, and `/team` for access reviews.

## Screens

- `/team` is where an admin manages their own organisation. The firm's admins and a client's admins get the same screen: invite (only roles that fit the organisation; a consultant-managed client has no logins), open invitations with revoke, and a menu per person to change the address, reset two-factor sign-in, switch off with a reason, switch back on, or erase (firm admins only). The same screen also covers the email domains and the access review, where everyone ticked stays and each unticked person needs a reason.
- `/clients/:id/people` gives the firm's admins that screen for a client, reached from the client page.
- `listPeople` returns the organisation's kind and engagement mode, who has two-factor on (through `app_two_factor_status`, so only admins see it), and `can.erase`. The server checks every action again.

## Known limits

- An invitation or address change to an address that already has an account is refused, and that reveals to an admin that the address is in use somewhere. Unique addresses make this unavoidable. The refusal names no organisation.
- Not built yet: single sign-on.
- The sender has been tested against the database with a fake relay, not against a real SMTP server.
