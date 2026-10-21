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

## Mail

`outbound_emails` is a queue of links only, never content: the reader signs in to see anything. Only database functions write to it, so no app bug can send mail to an arbitrary address. The kinds are invitation, address-change confirmation and notice, and access review due.

## Known limits

- An invitation or address change to an address that already has an account is refused, and that reveals to an admin that the address is in use somewhere. Unique addresses make this unavoidable. The refusal names no organisation.
- Not built yet: the mail sender job (it needs the server's SMTP settings), 2FA enforcement for admins and consultants, password reset, and single sign-on.
