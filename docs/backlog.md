# Backlog

Open work for this project, including where it deviates from the shared skills
(the `nextcloud` plugin and `~/Code/claude-config/skills`). Not loaded at session
start. One line per item: date, the skill it concerns, what to do.

## Deviations from shared skills
- 2026-11-24 · responsive-layout · Narrow layouts use window breakpoints (cards ≤ 700px, medium 701–1100px) and an own `matchMedia` ref (`useCardLayout`) instead of `useIsMobile()` and content-width steps. Check first: between 700 and 1024px the navigation is already an overlay, but the card-mode "Add flight" button isn't shown.
- 2026-11-24 · php-backend · CLAUDE.md "Configuration storage" says `IConfig::setUserValue`/`setAppValue`; the code no longer uses them. Correct it in the CLAUDE.md restructure.
- 2026-11-24 · ocs-errors · CLAUDE.md says OCS answers XML without `?format=json` even with `Accept: application/json`; the ocs-errors guide found JSON with `@nextcloud/axios`. Recheck, then correct whichever is wrong.
- 2026-11-24 · eslint-v9-migration · Still on `@nextcloud/eslint-config` 8 with `.eslintrc.cjs`, base `@nextcloud` config. Migrate to v9 (flat config).
