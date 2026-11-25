# CLAUDE.md — Flight Journal

A Nextcloud app for tracking personal flight history: one row per flown leg, with
airports and aircraft reconciled against instance-wide reference data, a map and
analytics. Targets Nextcloud 33–36 (PHP 8.2+), per `appinfo/info.xml`.

Detail loads only when needed:

| Where | What | Loads |
|---|---|---|
| `.claude/rules/backend.md` | Backend layout, the flights table and its validation, reference and enrichment tables, within-day ordering (`day_seq`), PHPUnit | `lib/**`, `tests/unit/**` |
| `.claude/rules/airports.md` | Airport reconciliation, distance | its service, `FlightService`, `AirportMapper`, `AirportResolution.vue` |
| `.claude/rules/aircraft.md` | Aircraft reconciliation, canonical model ranking, the aircraft editor | its services, `AircraftTypeMapper`, the aircraft components, `types.ts` |
| `.claude/rules/frontend.md` | Narrow widths, frontend tests | `src/**`, `tests/frontend/**` |
| `.claude/rules/flight-log.md` | Bulk edit, view filtering | `ViewFlightLog`, `BulkEditDialog`, `filters.ts`, … |
| `.claude/rules/reference-views.md` | Airports and Aircraft types views, flight counts, admin import | those views, admin settings, import services |
| `.claude/rules/import-export.md` | Markdown and JSON import/export, the replace option | import/export services, `PersonalSettings.vue` |
| `.claude/rules/map.md` / `analytics.md` | The Map and Analytics views | their views and modules |
| `.claude/rules/fixtures.md` | The demo dataset and its generator | `tests/fixtures/**` |
| `docs/backlog.md` | Roadmap, open items, deviations from the shared skills | read when planning |
| nextcloud plugin skills | Platform knowledge shared by all apps | by topic |

## Design principles

- **Never block on enrichment.** Flights stay valid without reference data: no
  foreign keys to the reference tables, every lookup optional, the app fully
  usable on an instance with nothing imported.
- **Non-goals:** multi-leg trip grouping and departure/arrival times. The journal
  stores a local departure date, no times and no timezone.
- **Distances are always stored in km**; any unit conversion happens in the UI.
- **User scoping is enforced server-side** in services and mappers; never trust a
  `user_id` from the client.
- **Reference data is admin-imported, never committed** to the repository.
- Free APIs preferred for enrichment; an admin settings screen will hold optional
  API keys.

## Architecture

Backend in `lib/` (AppFramework; `QBMapper` + `IDBConnection`, no Doctrine ORM).
Frontend in `src/` (Vue 3 + TypeScript, `@nextcloud/vue`, Vite via
`@nextcloud/vite-config`):
- A single SPA mounted from `templates/index.php` into `#flightjournal`.
- Shell: `NcContent` + `NcAppNavigation` (left) + `NcAppContent` (right).
- Routing: `vue-router` in hash mode, to avoid Nextcloud route collisions. State: Pinia.
- API access: `@nextcloud/axios` + `generateOcsUrl` (never hand-build URLs).
  `ocsUrl()` in `src/api.ts` also appends `?format=json`: harmless, as OCS already
  answers JSON to `@nextcloud/axios`'s `Accept: application/json`.
- The personal and admin settings pages are separate small Vue mounts, not sharing
  the SPA's router or store.

## Commands

The Makefile is the shared one (nextcloud `app-project-files` skill): `make dev`,
`make lint` (includes `type-check`), `make test` (PHPUnit + Vitest), `make psalm`,
`make openapi`, `make check`. `make stage`, `make package` and `make appstore` are
release targets: Martin runs them.

```sh
npm run build
npm run lint
npm run stylelint
npm run type-check      # vue-tsc --noEmit, a gate (alias ts:check, used by CI)
npm run test:frontend   # Vitest, tests/frontend/**/*.spec.ts (alias test, used by CI)

composer lint
composer cs:check       # cs:fix to apply
composer psalm
composer test:unit
composer openapi
```

## Conventions

- **API:** OCS (`OCSController` + `DataResponse`). Read error messages with
  `ocsErrorMessage(e, fallback)` from `src/ocsError.ts` (why: nextcloud `ocs-errors`
  skill); it lives outside `api.ts` because many specs mock that module wholesale.
  The import/export parameter is `dataformat`, never `format` (php-backend skill).
- **UI:** `@nextcloud/vue` and `@nextcloud/dialogs` only (vue-frontend skill).
- **Configuration:** none stored yet, and no custom settings tables. When needed:
  `IAppConfig` for app-wide values, `IUserConfig` for per-user ones (php-backend skill).
- Prefix generic layout classes with `fj-`: core styles some bare class names
  globally (`.pager`).

## CI

The workflows are the `nextcloud/.github` org templates, synced and not edited
(nextcloud `github-ci` skill). This repo's deliberate changes, re-applied by every
sync: `update-nextcloud-ocp-matrix.yml.patch` (removes the owner guard and, like
`npm-audit-fix.yml.patch`, the bot approve/auto-merge steps: bot PRs are merged by
hand). `assign.yml` is local; `appstore-build-publish.yml` is not set up.
- The `ts:check` and `test` npm scripts exist only as aliases the templates call
  with `--if-present`: rename them and those jobs pass while running nothing.
- `psalm.xml`'s `phpVersion` must equal the Psalm matrix's computed `php-min` (8.2
  for NC 33), enforced by a grep step in `psalm-matrix.yml`; keep `composer.json`
  `php`/`platform.php` aligned. `roave/security-advisories` is deliberately not a
  dependency: against the fake `platform.php` 8.2.0 it breaks `composer update`.
