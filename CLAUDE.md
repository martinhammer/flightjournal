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
| `origin_label` | varchar(128), nullable | Free-text fallback when no IATA/ICAO exists (e.g. "Meedhupparu"). |
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

**Origin/destination UX:** the Add and Edit screens expose a single "Origin" / "Destination" text field each, written into `origin_label` / `destination_label`. The `origin_code` / `destination_code` columns are populated only by a future backend enrichment step (on save/edit/scheduled job) that recognises an entered string as an IATA/ICAO code and promotes it. UI display prefers `_label`, falling back to `_code` when only the code is present.

### Reference (instance-wide, no `user_id`)

- `flightjournal_airports` — `iata`, `icao`, `name`, `city`, `country_iso2`, `lat`, `lon`, `tz`, `source`, `updated_at`.
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

- [ ] Migration creating all five tables with indexes (reference tables empty for now).
- [ ] `Db/Flight` entity + `FlightMapper`.
- [ ] `Service/FlightService` with user-scoped CRUD + validation.
- [ ] `Controller/FlightApiController` (OCS): list, get, create, update, delete.
- [ ] `appinfo/routes.php` (frontpage route already declared via attribute on `PageController`).
- [ ] `Settings/Personal` + `Settings/PersonalSection` placeholder.
- [ ] SPA shell: `NcContent` + `NcAppNavigation` + `vue-router` with four routes.
- [ ] Edit flight form (functional).
- [ ] View flight list (functional table).
- [ ] Map, Analytics views — placeholder components.
- [ ] Personal settings Vue mount — placeholder.

### Milestone 1 explicit non-goals

Reference data seeding/autocomplete, map, analytics, enrichment, import/export, admin settings, units conversion UI, multi-leg trip grouping, departure/arrival times.

## Known scaffold quirks

- `vite.config.ts` references `src/main.js` but the file is `src/main.ts` — needs fixing when SPA shell lands.
- `composer.json` pins `nextcloud/ocp: dev-stable31` — keep in sync with `appinfo/info.xml` `min-version`.
