# Backlog

Open work for this project, including where it deviates from the shared skills
(the `nextcloud` plugin and `~/Code/claude-config/skills`). Not loaded at session
start. One line per item: date, the skill it concerns, what to do.

## Deviations from shared skills
- 2026-11-24 · responsive-layout · Narrow layouts use window breakpoints (cards ≤ 700px, medium 701–1100px) and an own `matchMedia` ref (`useCardLayout`) instead of `useIsMobile()` and content-width steps. Check first: between 700 and 1024px the navigation is already an overlay, but the card-mode "Add flight" button isn't shown.
- 2026-11-24 · eslint-v9-migration · Still on `@nextcloud/eslint-config` 8 with `.eslintrc.cjs`, base `@nextcloud` config. Migrate to v9 (flat config).

## Roadmap

Written at the start; Milestone 1 is finished and several items have landed since.

1. **Milestone 1 (current):** schema for all tables, flights CRUD, SPA shell with four views, minimal Edit + View screens, personal settings placeholder.
2. Bundled reference-data seed + autocomplete in editor. *(Done for aircraft: admin CSV import, reconciliation, and a type-ahead in the flight editor that can override the canonical model. Airports are admin-imported but the editor still has no airport autocomplete — that is the remaining half of this item.)*
3. Rich View flight log table (sort/filter/pagination).
4. Map view (Leaflet).
5. Analytics view (great-circle distances from cached coordinates; Chart.js). *(Done — see `.claude/rules/analytics.md`.)*
6. Enrichment providers (weather first); admin settings screen for API keys.
7. Import/export in personal settings.


## Open items

Recorded for priority review; nothing here is in progress.

### Aircraft data epic — remaining

- **Sorting the reference views by column, including the flight count.** Agreed four-step plan; step 1 (counts displayed) has landed. Remaining: (2) extract `ViewFlightLog`'s sort machinery into something shared, (3) client-side sorting for the flown-only mode, (4) server-side sorting for "Show all" — only if wanted. See the sorting note under "Flight counts on the reference views" in `.claude/rules/reference-views.md` for why the mode split exists.
- **IATA overlay** ([OpenFlights planes.dat](https://openflights.org/data.php), ~232 designators, ODbL). Needs no migration — `iata_code` already exists and stays NULL. Unblocks two things at once: the IATA column is currently *hidden* in `ViewAircraftTypes` because it would be blank on every row, and the OpenFlights names are the most plausible lever for the E190 ranking wart below.
- **E190 resolves to the bare "190".** Both it and "ERJ-190-100" carry the designator's digits, so the shortest-name rule picks the barer one. Not fixable by digit matching; see "Canonical ranking" in `.claude/rules/aircraft.md`.

### Test debt, ordered by evidence of harm

- **Nothing exercises mappers or migrations.** Both production failures — the migration that never ran (missing version bump) and `engine_type` declared too narrow for "Turboprop/Turboshaft" — were in this blind spot, and neither is reachable by a mocked-mapper unit test. Highest-value gap in the suite. Would also cover the aggregate SQL that a server-side flight count would need.
- **Controller tests cover only `FlightApiController`, `AirportApiController` and `SettingsApiController`.** The first was added after it silently dropped `aircraftManufacturer`/`aircraftModel`. `AircraftTypeApiController` and both admin controllers share the same explicit-parameter-list shape and have none. `SettingsApiControllerTest` cannot cover the export *downloads*: `DataDownloadResponse` needs `symfony/string`, which the OCP stubs don't ship (it would work under CI's server checkout, but not locally).
- **Test files are not type-checked** — `tsconfig.json` includes only `src/`. Fixture objects have drifted from `Flight` twice, with assertions passing by accident. Adding `tests/` would have caught both for free.

### Feature backlog

- **Bulk delete**, not started: with `showUndo` as a deferred commit (hide, then delete
  when the toast expires), since an apply-then-reverse undo would need a verbatim
  restore path. Design notes: `.claude/rules/flight-log.md`.

## Parked dependency bumps

- **Dependabot npm major bumps gated by Nextcloud tooling peers.** Two bumps are parked, not mergeable: vite 7→8 (PR #16) and TypeScript 5→6 (PR #3). Both fail CI at `npm ci` with `ERESOLVE` — not a code issue. `@nextcloud/vite-config@2.5.2` hard-pins `vite: ^7.1.10`; `@nextcloud/eslint-config@8.4.2` hard-pins `typescript: ^5.0.2`. Bump those Nextcloud packages first; the vite/TS bumps follow only once their peer ranges widen. Don't force with `--legacy-peer-deps` (the org-templated `npm-build.yml` workflow would also need editing, and edits there get overwritten).
