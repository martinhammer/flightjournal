# Flight Journal — Engineering Notes

A Nextcloud app for tracking personal flight history. Built iteratively, core-first.

## Architecture

Standard Nextcloud app shape. Backend in `lib/` (PHP 8.1+, AppFramework, no Doctrine ORM — use `QBMapper` + `IDBConnection`). Frontend in `src/` (Vue 3 + TypeScript, `@nextcloud/vue` components, Vite via `@nextcloud/vite-config`). Targets Nextcloud 31–32.

### Backend layout (`lib/`)

- `AppInfo/Application.php` — DI registration, listeners.
- `Controller/` — thin HTTP layer. SPA shell via `PageController`; JSON APIs via `OCSController` subclasses (`FlightApiController`, later `ReferenceApiController`, `EnrichmentApiController`, `SettingsApiController`).
- `Service/` — business logic. Controllers stay dumb; services own validation, user-scoping, enrichment orchestration.
- `Db/` — `Entity` + `QBMapper` per table. All user-data queries scoped on `user_id` inside the mapper, never trusted from the client.
- `Migration/` — versioned schema migrations (`Version000XDate…`).
- `BackgroundJob/` — `TimedJob`s for enrichment refresh and reference-data refresh (added in later milestones).
- `Settings/` — `IPersonalSection` + `IPersonal` (and later `IAdminSection` + `IAdmin` for API keys).

### Frontend layout (`src/`)

- Single SPA mounted from `templates/index.php` into `#flightjournal`.
- Shell: `NcContent` + `NcAppNavigation` (left) + `NcAppContent` (right) with four navigation entries: Edit flight log, View flight log, Map, Analytics.
- Routing: `vue-router` (hash mode to avoid Nextcloud route collisions).
- State: Pinia.
- API access: `@nextcloud/axios` + `generateOcsUrl` (NEVER hand-build URLs).
- Personal settings page is a separate, small Vue mount injected via the Settings API. Does not share the SPA bundle's router/store.

## Data model

### Core: `flightjournal_flights` (one row per leg)

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `user_id` | varchar(64), indexed | NC UID; every query scoped on this. |
| `flight_date` | date, indexed | Local departure date. No timezone — it's a journal, not an OPS log. |
| `origin_code` | varchar(8), nullable | IATA usually, ICAO acceptable. |
| `destination_code` | varchar(8), nullable | |
| `origin_label` | varchar(128), nullable | User's free-text entry; replaced with the reference airport name once reconciliation finds a match. |
| `destination_label` | varchar(128), nullable | |
| `airline_code` | varchar(4), nullable | "EY", "EK", "FZ". Split for analytics. |
| `flight_number` | varchar(8), nullable | Numeric portion only ("449"). |
| `aircraft_type_code` | varchar(8), nullable | Canonical ICAO type designator (`B77W`, `B789`, `B38M`, `DHC6`). |
| `aircraft_type_raw` | varchar(64), nullable | Verbatim user input ("B738-8 MAX"); preserved even after canonicalization. |
| `registration` | varchar(16), nullable | "A6-ECM". |
| `cabin_class` | varchar(16), nullable | Enum: `economy`, `premium_economy`, `business`, `first`, `other`. |
| `seat` | varchar(8), nullable | "12A". |
| `notes` | text, nullable | |
| `created_at`, `updated_at` | bigint (unix seconds) | |

Indexes: `(user_id, flight_date)`, `(user_id, airline_code)`, `(user_id, aircraft_type_code)`.

**Validation:** date, origin, and destination are all required (origin/destination satisfied by either `_code` or `_label`). Everything else optional.

**No FKs to reference tables** — flights remain valid even if reference data is missing or stale. This is a hard design principle: the app must be fully usable without enrichment.

**Origin/destination UX:** the Add and Edit screens expose a single "Origin" / "Destination" text field each, bound to `origin_label` / `destination_label`. The `origin_code` / `destination_code` columns are populated by airport reconciliation (see below). The Flights view route column displays `_code` when present, falling back to `_label`.

### Airport reconciliation

`Service/AirportReconciliationService::resolve(?string $label): ?AirportMatch` resolves a free-text label against `flightjournal_airports`. Matching is strictly **exact and tiered**, never fuzzy:

1. IATA or ICAO code (case-insensitive).
2. Airport `name` (case-insensitive; ignored if not unique).
3. `city` (case-insensitive; only if it resolves to exactly one airport).

First hit wins, returning an `AirportMatch` (canonical code + reference name). The canonical code is **IATA when present, else ICAO**. No match — or an ambiguous one — yields `null`; a null `_code` simply means "no confident match" (the design does not distinguish "never checked" from "checked, no match", and does not need to). Flights stay valid regardless.

**On a match, the label is overwritten with the reference airport name** (e.g. typing "LHR" stores `_code` = "LHR", `_label` = "London Heathrow"). The user's verbatim text is intentionally *not* preserved — an accepted tradeoff. A reference row with no name leaves the label untouched.

Reconciliation runs in four places, all delegating to the one resolver:

1. **New flight** — `FlightService::create` resolves both labels on save.
2. **Edit flight** — `FlightService::update` re-resolves on save.
3. **Bulk import** — `ImportService` goes through `FlightService::create`, so it is covered automatically.
4. **Recheck-all** — `FlightService::reconcileAll` + `POST /api/v1/flights/reconcile` (scope `missing` | `all`), triggered from the Personal settings page with a toggle for whether to re-check flights that already have a code.

`applyData` still honours an explicit client-supplied `originCode` / `destinationCode` when present; the SPA never sends them, so in practice codes always come from the resolver. Interactive autocomplete at entry time is a separate, later step.

### Reference (instance-wide, no `user_id`)

- `flightjournal_airports` — `iata`, `icao`, `name`, `city`, `state`, `country_iso2`, `lat`, `lon`, `elevation` (feet, integer), `tz`, `source`, `updated_at`.
- `flightjournal_aircraft_types` — `icao_code` (PK), `iata_code`, `manufacturer`, `model`, `variant`, `engine_type`.
- `flightjournal_airlines` — `iata`, `icao`, `name`, `country_iso2`, `active`.

Shared across all users on the instance. Read-mostly. Populated lazily (autocomplete miss → upstream fetch → upsert) and optionally via scheduled bulk refresh.

### Enrichment cache: `flightjournal_enrichments`

Keyed on `(flight_id, provider, kind)` with a JSON `payload` blob and `fetched_at`. Examples of `kind`: `weather_origin`, `weather_destination`, `aircraft_details`, `route_distance`. Always treated as cache.

## Configuration storage

- **Per-user prefs** (units, default cabin, etc.) → `IConfig::setUserValue('flightjournal', …)`.
- **App-wide settings** (API keys, refresh schedule, seed version) → `IConfig::setAppValue`.
- No custom settings tables.

## Conventions

- Distances always stored in km; UI converts based on user pref.
- Reference-data lookups: never block flight saves on upstream availability; treat all enrichment as optional.
- API responses: OCS envelope (use `OCSController` + `DataResponse`). Use `generateOcsUrl` on the frontend, and append `?format=json` to every OCS URL — without it NC OCS replies in XML even when `Accept: application/json` is set. Also avoid using `format` as a controller parameter name; OCS reserves it for response-format selection and a body/query `format` value will override the response format. Use a descriptive non-reserved name like `dataformat`.
- User-scoping is enforced server-side in services/mappers; never trust a `user_id` from the client.
- Free APIs preferred for enrichment; admin settings screen will hold optional API keys/tokens.
- **All UI elements must come from the Nextcloud toolkit** (`@nextcloud/vue` components, `@nextcloud/dialogs` for toasts/confirmations/modals). Never use raw browser primitives like `confirm()`, `alert()`, `prompt()`, or unstyled `<input>`/`<button>`.

## Iteration roadmap

1. **Milestone 1 (current):** schema for all tables, flights CRUD, SPA shell with four views, minimal Edit + View screens, personal settings placeholder.
2. Bundled reference-data seed + autocomplete in editor.
3. Rich View flight log table (sort/filter/pagination).
4. Map view (Leaflet).
5. Analytics view (great-circle distances from cached coordinates; Chart.js).
6. Enrichment providers (weather first); admin settings screen for API keys.
7. Import/export in personal settings.

## Milestone 1 — definition of done

Install on NC 31, navigate to Flight Journal, create a flight via the Edit form, see it in the View list, edit it, delete it, and find a "Flight Journal" entry under Personal settings (placeholder content).

### Milestone 1 task list

- [x] Migration creating all five tables with indexes (reference tables empty for now).
- [x] `Db/Flight` entity + `FlightMapper`.
- [x] `Service/FlightService` with user-scoped CRUD + validation.
- [x] `Controller/FlightApiController` (OCS): list, get, create, update, delete.
- [x] Routing — all controllers use attribute routing (`#[ApiRoute]`, `#[FrontpageRoute]`); no `appinfo/routes.php` needed.
- [x] `Settings/Personal` + `Settings/PersonalSection` placeholder.
- [x] SPA shell: `NcContent` + `NcAppNavigation` + `vue-router` with four routes.
- [x] Edit flight form (functional).
- [x] View flight list (functional table).
- [x] Map, Analytics views — placeholder components.
- [x] Personal settings Vue mount — placeholder.

Milestone 1 is complete: code implemented and verified end-to-end against NC 31 per the DoD above.

### Post-M1 additions already landed

- **Admin settings page** (`Settings/Admin` + `Settings/AdminSection`, mounted via `src/adminSettings.ts` → `views/AdminSettings.vue`) for managing instance-wide reference data.
- **Airport reference import/delete**: `Db/Airport` + `AirportMapper`, `Service/AirportImportService` (JSON keyed by ICAO, upsert semantics), `Controller/AirportAdminApiController` exposing `POST /api/v1/admin/airports/import`, `DELETE /api/v1/admin/airports`, `GET /api/v1/admin/airports/count`. Admin-only (no `#[NoAdminRequired]`).
- **Airport browse view**: read-only `views/ViewAirports.vue` (route `/airports`, in the SPA navigation), backed by `Controller/AirportApiController` `GET /api/v1/airports` (paginated, searchable on icao/iata/name/city). Each row has a three-dot menu ("Show flights to / from / to and from `<code>`") that navigates to the Flights view with an airport filter applied.
- **Flights view filtering**: `ViewFlightLog.vue` reads filters from the route query and shows them as removable `NcChip`s above the table. Filters are modelled generically (`buildFilters()` → `ActiveFilter[]` with `id`, `label`, `queryKeys`, `matches`); the airport filter uses query keys `airport` + `airportDir` (`to` | `from` | `either`). New filter types extend `buildFilters()`; the chip row and clearing are generic over the shape.
- **Airport reconciliation**: `Service/AirportReconciliationService` wired into flight create/update/import plus a recheck-all action in Personal settings. See "Airport reconciliation" above.

### Milestone 1 explicit non-goals

Reference data seeding/autocomplete, map, analytics, enrichment, import/export, admin settings, units conversion UI, multi-leg trip grouping, departure/arrival times.

## Known scaffold quirks

- `composer.json` pins `nextcloud/ocp: dev-stable31` — keep in sync with `appinfo/info.xml` `min-version`.
- **Dependabot npm major bumps gated by Nextcloud tooling peers.** Two bumps are parked, not mergeable: vite 7→8 (PR #16) and TypeScript 5→6 (PR #3). Both fail CI at `npm ci` with `ERESOLVE` — not a code issue. `@nextcloud/vite-config@2.5.2` hard-pins `vite: ^7.1.10`; `@nextcloud/eslint-config@8.4.2` hard-pins `typescript: ^5.0.2`. Bump those Nextcloud packages first; the vite/TS bumps follow only once their peer ranges widen. Don't force with `--legacy-peer-deps` (the org-templated `node.yml` workflow would also need editing, and edits there get overwritten).

## PHPUnit tests — to revisit

Initial unit coverage lives under `tests/unit/Service/` (`FlightServiceTest`, `ImportServiceTest`). Wired up via `tests/phpunit.xml` and runnable through `composer test:unit` / `make test`. `tests/bootstrap.php` registers a PSR-4 prefix for `nextcloud/ocp` because that package ships stubs without its own autoloader — revisit if the OCP package starts autoloading itself or if tests start needing a real Nextcloud server bootstrap.

Still missing and worth adding once the API surface settles past Milestone 1:

- `Service/ExportService` — small, smoke test only.
- `Controller/FlightApiController` and `Controller/SettingsApiController` — happy-path + error-path per endpoint.
- Integration-style tests for `Db/FlightMapper` and migrations (need a real DB; currently out of scope for unit tests).

Bugs surfaced while writing the tests (pinned by current tests, not yet fixed):

- `ImportService::splitFlightNumber` — the regex `^([A-Z0-9]{2,3})\s*(\d+)$` is greedy on the prefix, so `SK4745` splits as `SK4`/`745` and `W61383` as `W61`/`383`. The intent was a 2-letter airline + the rest as flight number. Tests currently encode the buggy behaviour — fix the regex (likely make the prefix non-greedy or anchor on letters first) and update the assertions together.
