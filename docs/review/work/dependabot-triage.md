# Dependabot triage (2026-11-19, read only)

Checked against `origin/main` fa43936. Nothing was merged, closed, approved or commented on.

## Headline findings

1. **No PR is "covered" by main.** The Next.js update (#158, Next 16.4.2 to 16.4.6, Node 22.12 required) moved the web app to exactly the versions these PRs start from: main has vitest ^4.1.12, eslint ^9.39.5, typescript ^5.9.3, @types/node ^22.20.5, node:22-alpine, fastapi 0.136.0, uvicorn 0.37.0, pydantic-settings 2.11.0, and the old image tags. So there is nothing to close as "covered".
2. **Every PR merges cleanly into main today** (checked with `git merge-tree` for all 17). GitHub shows mergeable "UNKNOWN" because the branches are old: the PRs are 49 to 109 commits behind (created 23 Oct to 13 Nov), and their CI ran on 17 Nov against old bases. Green CI is therefore a weaker signal than it looks. Ask Dependabot to rebase (`@dependabot rebase`) before merging anything that matters.
3. **CI does not exercise the Docker images.** `.github/workflows/ci.yml` only starts pgvector and clamav as services. It runs web, database, scan and ai (Python 3.13 via setup-python, not the Dockerfile). Green CI on #148, #144, #143, #142, #141, #139, #45 says nothing about the image itself. Those need the full stack check.
4. PRs #46, #50, #140 all edit `ci.yml`; #144, #143, #142, #139 all edit `docker-compose.yml`; #49, #51, #52 all edit `services/ai/requirements.txt`. Each merges cleanly alone, but after the first one lands the others may conflict on neighbouring lines and need a Dependabot rebase.

## Table

| PR | Update | Class | Reason |
|---|---|---|---|
| #148 | python 3.13 to 3.15-slim (services/ai) | **CLOSE (not recommended)** | Pinned deps have no Python 3.15 wheels (pydantic-core 2.41.4, pyyaml); slim image has no compiler, so the build would fail or compile from source. CI tests 3.13 only. |
| #144 | gotenberg 8.38.1 to 8.39.0 | **MERGE (safe), after stack check** | Minor with security fixes. Production PDF image; CI does not run it. We only call `/forms/chromium/convert/html`. |
| #143 | caddy 2.10.2 to 2.11.7 (alpine) | **MERGE (safe), after stack check** | Minor, production edge. CI does not run it; check both `direct` and `tunnel` profiles with our Caddyfile. |
| #142 | rustfs 1.0.3 to 1.0.4 | **MERGE (safe), after stack check** | Patch (trust-store and dependency refresh), but it is the file store. Test upload/download first. 1.0.6 already exists. |
| #141 | mailpit v1.29 to v1.32 | **MERGE (safe)** | Test compose only, not used in CI or production. Security fixes. |
| #140 | actions/setup-python 5 to 7 | **MERGE (safe)** | Workflow change ran green in its own PR. v7 only removes the `pip-install` input (we do not use it). |
| #139 | cloudflared 2025.10.0 to 2026.10.4 | **MERGE (safe), after stack check** | Year-old tunnel client; production tunnel profile, not covered by CI. 2026.11.1 is out; ask for a rebase to take it. |
| #57 | vitest 4 to 5 | **NEEDS OWNER** | Fails CI: `Cannot find package 'vite'`. Vitest 5 needs `vite` installed as its own dev dependency. Small fix, then merge. Dev only. |
| #56 | @types/node 22 to 26 | **CLOSE (not recommended)** | Types must match the runtime (Node 22). Fails typecheck in `src/lib/clamd.ts` and `tests/clamd.test.ts`. |
| #55 | eslint 9 to 10 | **NEEDS OWNER** | CI green, but only because `legacy-peer-deps=true` hides that the Next lint plugins do not declare eslint 10. Dev only. Recommend defer. |
| #54 | typescript 5.9 to 7.0 | **CLOSE (not recommended)** | CI lint fails: "typescript-eslint does not support TS 7.0". |
| #52 | pydantic-settings 2.11 to 2.16.1 | **MERGE (safe)** | Minor; needs Python 3.11+ (we are on 3.13); pydantic>=2.7 satisfied by our 2.12.3. CI green. |
| #51 | fastapi 0.136.0 to 0.156.2 | **MERGE (safe)** | Pre-1.0 minor series; needs pydantic>=2.9, python>=3.10. CI ai tests green. Runs in the ai image: include in stack check. |
| #50 | actions/setup-node 4 to 7 | **MERGE (safe)** | We set `cache: npm` and `node-version` explicitly, so the v5/v6 cache changes do not affect us. CI green. |
| #49 | uvicorn 0.37.0 to 0.54.0 | **MERGE (safe)** | Python >=3.10; CMD flags unchanged (`--host --port --no-server-header`). CI green. In ai image: stack check. |
| #46 | actions/checkout 4 to 7 | **MERGE (safe)** | v7 blocks fork-PR checkout for `pull_request_target`/`workflow_run` (we use neither). CI green. |
| #45 | node 22-alpine to 25-alpine | **CLOSE (not recommended)** | Node 25 is not an LTS and has no support window; vitest 5 would not support it either. Stay on 22 (or choose 24 deliberately). |

## Notes on the non-trivial ones

**#148 python 3.15.** I asked pip for Linux x86_64 wheels for Python 3.15 for everything in `services/ai/requirements.txt`. `pyyaml` (pulled in by `uvicorn[standard]`) has no 3.15 wheel at all, and `pydantic-core==2.41.4` (the one `pydantic==2.12.3` pins) has none either: the only 3.15 builds are 2.48.0 and later, which need a newer pydantic. `python:3.15-slim` has no build tools, so `pip install` in `services/ai/Dockerfile` would fail. `uvloop`, `httptools`, `websockets` and `watchfiles` do have 3.15 wheels. CI cannot catch this because it installs on 3.13. I did not build the image. Stay on 3.13 (or 3.14 later, after a real build).

**#57 vitest 5.** `npm view vitest@5.1.0` shows peer dependency `vite ^6.4 || ^7 || ^8` (it no longer brings Vite in itself), and the PR's lockfile removed the old bundled rolldown packages. CI error (web job, 17 Nov): `Cannot find package 'vite' imported from node_modules/vitest/...`. The database and scan jobs fail the same way. Engines `^22.12 || ^24 || >=26` match our `>=22.12`. Our three vitest configs (`apps/web/vitest.config.ts`, `vitest.db.config.ts`, `vitest.scan.config.ts`) use only `resolve.alias`, `include` and `exclude`, so no config break is expected. Decision for the owner: do the small rework (add `vite` as a dev dependency, rerun CI), or leave vitest on 4. Dev tooling only; no production effect.

**#56 @types/node 26.** Runtime is Node 22 (Dockerfile and CI, `engines >=22.12`). The failing errors are `src/lib/clamd.ts(33,42)` (`string | NonSharedBuffer` not assignable to `Buffer`) and `tests/clamd.test.ts(13,33)`. Beyond those, types for Node 26 would describe APIs the runtime does not have. Suggest `ignore: update-types: [version-update:semver-major]` for `@types/node` in `.github/dependabot.yml`.

**#54 TypeScript 7.** Native compiler. CI web job: `Error: typescript-eslint does not support TS 7.0` (stack in `eslint-config-next/dist/index.js`). typescript-eslint latest declares `typescript >=4.8.4 <6.1.0`. Our tsconfig (`moduleResolution: bundler`, `incremental`, Next plugin) would also need checking. Revisit when typescript-eslint and Next support 7.

**#55 eslint 10.** CI web job passed lint, typecheck, tests and build. Caveats: `apps/web/.npmrc` has `legacy-peer-deps=true`, so npm did not complain that `eslint-plugin-react` 7.37.5 (peer eslint up to ^9.7), `eslint-plugin-import` (up to ^9) and `eslint-plugin-jsx-a11y` (up to ^9) are not declared compatible with eslint 10. `eslint-config-next@16.4.6` itself allows `>=9`. Our `eslint.config.mjs` is already flat config, so no migration is needed. eslint 10 needs Node `^20.19 || ^22.13 || >=24`; CI uses `node-version: 22` (latest 22.x), fine, but our stated floor is 22.12. Low risk but unsupported by the plugins; lint rule crashes or silently skipped rules are the failure mode. Recommend deferring until the Next lint config supports it; if the owner prefers, merge after a rebase and a green CI.

**#45 node 25.** Odd-numbered Node releases are never LTS. Also the web Dockerfile `node:22-alpine` is used for both build and runner stages. If the owner wants a newer line, the LTS choice is `24-alpine` (a separate, deliberate change with a full stack check), not 25.

**Docker and compose PRs (#144, #143, #142, #139, #141).** Release notes: Gotenberg 8.39.0 is a security release (ExifTool option alias, non-http(s) URL routes, WebSocket deny rules); our only call is `/forms/chromium/convert/html` (`apps/web/src/services/pdf.ts:42`). RustFS 1.0.4: trust roots and dependency refresh. Mailpit 1.30 added a 50 MB default message limit and 1.32 a thumbnail DoS fix (test stack only). Caddy 2.11 and cloudflared 2026.x: no release notes were read in depth; the Caddyfile uses `servers { client_ip_headers ... trusted_proxies static ... }`, `encode`, `header`, `reverse_proxy`, so test both edge profiles. Suggested stack check: `docker compose up` for the default stack, then render one PDF, upload and download one file, and load the site through the `direct` profile; the tunnel needs a real token and can only be checked on the server.

**GitHub Actions (#46, #50, #140).** v7 of each is an ESM rewrite on the Node 24 runtime (the Node 24 move was v5/v6, and ubuntu-latest runners are well past the required 2.327.1). Breaking items in the chain: setup-node v5 turns on automatic package-manager caching when `packageManager` is set (we pin `cache: npm`, no effect); v6 limits automatic caching to npm; setup-python v7 removes the `pip-install` input; checkout v7 blocks fork PR checkouts under `pull_request_target`/`workflow_run`. Our workflow uses none of these. Because a PR's own workflow file runs in its own CI, the green checks on these three are real evidence.

## Suggested order for the lead

1. Ask Dependabot to rebase the keepers, then merge in this order, re-checking CI after each: #46, #50, #140 (CI), then #52, #51, #49 (ai deps, one at a time), then #141.
2. Run the full stack check once with #144, #143, #142, #139 combined (or one by one if something breaks), then merge.
3. Close #148, #56, #54, #45 with a short reason. Consider ignore rules in `.github/dependabot.yml` for @types/node major, typescript major and the Node base image major (keep 22).
4. List for the owner: #57 (add vite, or leave vitest 4) and #55 (defer, or merge).

## Outcome (19 Nov night, owner's decisions)

| PR | Outcome |
|---|---|
| #141, #52, #51, #49 | Merged by the lead (CI green after rebase) |
| #50, #140 | Merged by Fahad (the lead's `gh` token has no `workflow` scope) |
| #46 | Merged by Fahad |
| #148 Python 3.15, #45 Node 25, #54 TypeScript 7, #56 @types/node 26 | Closed with a comment giving the reason |
| #57 vitest 5, #55 eslint 10 | **Deferred, left open** (owner's decision). vitest 5 needs `vite` added as a dev dependency; eslint 10 passes only because `legacy-peer-deps` hides that the Next lint plugins don't support it yet. Revisit when the plugins declare eslint 10 support |
| #144 gotenberg, #143 caddy, #142 rustfs, #139 cloudflared | Being checked on the production-like test stack (`e2e-stack-run.md`), then merged |
