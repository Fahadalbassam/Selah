# Firm settings

`/settings` is for the firm's admins (`firm_settings.manage`). There is one `firm_settings` row per firm. It is created on the first save, and until then the database defaults apply and the page shows them. Each card saves only its own fields (`PATCH /api/firm/settings`), and the audit log records the names of the fields changed, never their values.

| Setting                 | Default    | Range                              | Used by                                                                                                                                                          |
| ----------------------- | ---------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intake_email`          | none       | an address                         | Each new inquiry queues an `inquiry.new` mail to it, with a link to `/inquiries/:id` and nothing else. The in-app notice to every firm admin is sent either way. |
| `suggestions_enabled`   | on         |                                    | Lead suggestions on an inquiry, from declared expertise.                                                                                                         |
| `kpi_grace_days`        | 10         | 0 to 90                            | Days after a business indicator's period ends before a missing value shows as missing.                                                                                          |
| `stale_days`            | 14         | 1 to 365                           | An open action untouched this long is stale.                                                                                                                     |
| `checkin_days`          | 30, 60, 90 | up to 6 days, 1 to 730, increasing | Check-ins after handover.                                                                                                                                        |
| `access_review_days`    | 90         | 7 to 365                           | How often each organisation's admins are asked to review access.                                                                                                 |
| `restricted_max_admins` | 2          | 1 to 10                            | Accounts a restricted client may have.                                                                                                                           |
| `minimal_purge_days`    | 90         | 0 to 3650                          | Days after handover before a minimal-records client's free text is cleared.                                                                                      |
| `transcript_keep_days`  | 30         | 1 to 90                            | Days a transcript is kept after its summary is confirmed.                                                                                                        |
| `chat_archive_days`     | 30         | 7 to 365                           | Days without a message before an assistant chat is archived, unless its owner keeps it.                                                                          |
| `chat_after_close_days` | 90         | 0 to 365                           | Days after a project closes before its assistant chats are deleted.                                                                                              |
| `chat_idle_delete_days` | 180        | 30 to 730, more than archive days  | Days after a chat's last message before it is deleted, even while the project is open.                                                                           |

The ranges are database checks (the Firm settings section of `drizzle/0000_baseline.sql`, and the sections of each setting's feature), and the API checks the same ranges first so the page can say what is wrong. The firm's email domains are set on `/team` with its people.

Not here yet: a switch for client access to the assistant. That waits for the client AI layer and its security review.
