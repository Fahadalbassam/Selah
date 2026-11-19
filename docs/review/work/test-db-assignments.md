# Test database assignments (one owner at a time)

Every helper that touches Postgres gets exactly one database from this list and no other. The lead updates this file before starting a helper. Reviewers get their own database, never the builder's.

| Database | Current owner | Since |
|---|---|---|
| selah_check | lead's screen checks only | — |
| selah_test_p | free (Arabic search merged) | — |
| selah_test_r | AI calls as jobs builder | 19 Nov night |
| selah_test_s | free (eval data from #207) | — |
| selah_test_t | reviewer of AI jobs (PR #211) | 19 Nov night |
| selah_test_u | number scanner builder | 19 Nov night |
| selah_test_d | free | — |
