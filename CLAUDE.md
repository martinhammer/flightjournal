# Flight Journal — Engineering Notes

A Nextcloud app for tracking personal flight history. Built iteratively, core-first.

## Architecture

Standard Nextcloud app shape. Backend in `lib/` (PHP 8.1+, AppFramework, no Doctrine ORM — use `QBMapper` + `IDBConnection`). Frontend in `src/` (Vue 3 + TypeScript, `@nextcloud/vue` components, Vite via `@nextcloud/vite-config`). Targets Nextcloud 33–34 (PHP 8.2+).

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
| `day_seq` | integer, NOT NULL default 0 | Within-day ordering key for multiple legs on the same `flight_date`. Dense 1-based; only its order relative to the same `(user_id, flight_date)` legs matters. See "Within-day ordering" below. |
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
| `distance_km` | integer, nullable | Great-circle distance between the two reconciled airports, whole km. Derived field (not enrichment cache): recomputed by reconciliation, `NULL` unless both endpoints resolve to reference coordinates. |
| `created_at`, `updated_at` | bigint (unix seconds) | |

Indexes: `(user_id, flight_date)`, `(user_id, airline_code)`, `(user_id, aircraft_type_code)`.

**Validation:** date, origin, and destination are all required (origin/destination satisfied by either `_code` or `_label`). Everything else optional.

**No FKs to reference tables** — flights remain valid even if reference data is missing or stale. This is a hard design principle: the app must be fully usable without enrichment.

**Origin/destination UX:** the Add and Edit screens expose a single "Origin" / "Destination" text field each, bound to `origin_label` / `destination_label`. The `origin_code` / `destination_code` columns are populated by airport reconciliation (see below). The Flights view route column displays `_code` when present, falling back to `_label`.

### Within-day ordering

When a user flies more than one leg on a given `flight_date`, `day_seq` records the order without introducing a "trip"/multi-leg concept or any departure/arrival times (still a non-goal). The value is **purpose-built and display-independent**: only its order relative to the other legs of the same `(user_id, flight_date)` is meaningful — gaps and absolute values are irrelevant, so deletes never renumber.

- **Assignment is automatic.** `FlightService::create` appends each new leg to the end of its day (`day_seq = FlightMapper::maxDaySeqForDate(user, date) + 1`); the first leg of a day gets 1. Import goes through `create`, so a bulk import is sequenced in file order. `update` only re-sequences when `flight_date` itself changes (re-appends to the new day, leaving the old day's gap); editing any other field never touches order. The user never sees or types the number.
- **Correction is a one-step swap.** `FlightService::move(id, user, 'earlier'|'later')` swaps `day_seq` with the adjacent same-day leg (no-op at the day's edge), exposed as `POST /api/v1/flights/{id}/move`. Direction is expressed in **day order, not screen position**: `earlier` = toward leg 1 (lower `day_seq`), `later` = away from it. The endpoint returns only the moved leg, so the store re-fetches to keep the swapped neighbour in sync.
- **Sort follows the day direction.** `FlightMapper::findAllForUser` orders `flight_date DESC, day_seq DESC, id DESC` — all three keys move in lockstep, so the newest day's *last* leg sits on top (and an oldest-first view leads with the oldest day's *first* leg). The Flights view mirrors this client-side: its date sort uses `day_seq` as the same-direction within-day tiebreak.
- **Frontend (`ViewFlightLog.vue`):** up/down chevrons appear only on rows of a multi-leg day, and only in the natural date-sorted, unfiltered view (otherwise the visual neighbour isn't the day-order neighbour). The view owns the one sort-direction-dependent fact — which way the arrow points — translating the chevron into `earlier`/`later` based on the active date sort direction (newest-first → up = `later`).
- **Existing data** is backfilled by `Migration\Version0003…`: within each `(user_id, flight_date)` it assigns `1..N` in `id` order (creation order is the best available proxy for intended sequence); any day is correctable afterward with the move action.

### Airport reconciliation

`Service/AirportReconciliationService::resolve(?string $label): ?AirportMatch` resolves a free-text label against `flightjournal_airports`. Matching is strictly **exact and tiered**, never fuzzy:

1. IATA or ICAO code (case-insensitive).
2. Airport `name` (case-insensitive; ignored if not unique).
3. `city` (case-insensitive; only if it resolves to exactly one airport).

First hit wins, returning an `AirportMatch` (canonical code + reference name). The canonical code is **IATA when present, else ICAO**. No match — or an ambiguous one — yields `null`; a null `_code` simply means "no confident match" (the design does not distinguish "never checked" from "checked, no match", and does not need to). Flights stay valid regardless.

**On a match, the label is overwritten with the reference airport name** (e.g. typing "LHR" stores `_code` = "LHR", `_label` = "London Heathrow"). The user's verbatim text is intentionally *not* preserved — an accepted tradeoff. A reference row with no name leaves the label untouched.

**Label → code vs. code → refresh (the reconciliation hybrid).** A free-text *label* is only resolved to *find* a code. Once an endpoint has a code, that code is authoritative: a *refresh* resolves the **code** itself (tier 1), adopting the reference name/coordinates and canonicalising the code (e.g. ICAO → IATA). A failed refresh — no matching reference row, or none loaded — **leaves the endpoint untouched**, never clearing a valid code. The label is trusted only when there is no code to trust instead. This keeps a bulk recheck non-destructive for data whose stored label isn't itself resolvable (the JSON backup preserves verbatim codes + labels *by contract*; an imported or handcrafted file may carry a city name like "Dublin" — ambiguous by city, matching nothing by name), and safe to run on an instance with no reference data loaded. The one place this is *overridden* is an explicit user edit: when the user changes an endpoint's label, that new label is re-resolved (label → code) even though a code is present — see Edit flight below.

Reconciliation runs in four places, all delegating to the one resolver:

1. **New flight** — `FlightService::create` resolves both labels on save.
2. **Edit flight** — `FlightService::update` re-resolves **only an endpoint whose label the user actually changed** (`resolveEndpointForUpdate`). An origin/destination whose submitted label equals the stored one is preserved verbatim — its code, label and (when both sides are preserved) distance are kept, and coordinates for a partial-change distance recompute are refreshed by resolving the *stored code*, not the label. This is deliberate: a stored label is not guaranteed to re-resolve (e.g. an imported city name like "Dublin" — ambiguous by city, no exact name match), so blindly re-reconciling on every edit would let an unrelated change like the seat silently clear the route's code/distance. A genuinely edited label is reconciled afresh exactly as on create (and an unresolved new label still clears the stale code, as intended).
3. **Bulk import** — `ImportService` goes through `FlightService::create`, so it is covered automatically.
4. **Recheck-all** — `FlightService::reconcileAll` + `POST /api/v1/flights/reconcile` (scope `missing` | `all`), triggered from the Personal settings page with a toggle for whether to re-check flights that already have a code. Each processed side goes through the hybrid (`refreshEndpoint`): a coded side is refreshed *from its code* (a failed lookup preserves it untouched); a code-less side is resolved *from its label*, as on create. So `all` scope is a **refresh, not a re-guess** — it canonicalises codes and rewrites labels to reference names, but never clears a code just because the label stopped resolving, and is a no-op on data already consistent with the reference.

`applyData` still honours an explicit client-supplied `originCode` / `destinationCode` when present; the SPA never sends them, so in practice codes always come from the resolver. Interactive autocomplete at entry time is a separate, later step.

**Distance** is computed in the same breath as reconciliation. `AirportMatch` carries the reference `lat`/`lon`, and `FlightService` sets `distance_km` via `Service/GreatCircle::distanceKm()` (pure haversine, whole km) whenever **both** endpoints resolve to coordinates — otherwise `NULL`. It is a deterministic derived field, not provider/cache data, so it lives as a column rather than in `flightjournal_enrichments`. In `create`/`update` (and import) both endpoints are always resolved, so distance tracks the current route. In `reconcileAll` distance is only recomputed when both sides resolve to coordinates in the pass; a side skipped under `missing` scope — or one preserved without a fresh match (a coded side whose code didn't resolve) — leaves the existing distance untouched. Existing flights are backfilled by running recheck-all with scope `all`.

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
- **View filtering** (`src/filters.ts`): the filter model is shared by the Flights and Map views so both interpret the route query identically. `buildFilters(query)` → `ActiveFilter[]` (each with `id`, `label`, `queryKeys`, `matches`); `applyFilters(flights, filters)` applies them (AND). The airport filter uses query keys `airport` + `airportDir` (`to` | `from` | `either`) — **both** are required; `airport` alone is only a Map focus hint, not a filter. The single-flight filter uses query key `flight` (an id) — set by the "View on map" item in each flight's row menu. The route filter uses `routeA` + `routeB` + `routeDir` (`ab` directional | `both`) — set by the arc popup on the Map view. Two toggle filters (set by the `FilterPicker` menu, query value `1`) carry no editor: `unmatched` matches legs missing either airport `_code` (the picker only offers it when the instance has airport reference data — probed once on mount via `listAirports(total)`), and `multiday` matches legs on any date with more than one flight (offered only when such a day exists; its multi-day set is derived from the full list, so it keeps whole days intact — and `ViewFlightLog` therefore still allows within-day reordering when `multiday` is the *only* active filter). Both round-trip to the Map view like every other filter (shared model + the cross-view buttons carry the full query). On the Map the `unmatched` filter simply shows no arcs — partial legs need both endpoints to draw a line — but any *matched* endpoint of those legs still plots as a marker, a deliberate visual cue for spotting data to fix. New filter types extend `buildFilters()`; the chip row and clearing are generic over the shape. Both views show removable `NcChip`s for the active filter plus a reciprocal cross-view button that carries the query across — "View on map" (`ViewFlightLog` → `/map`) and "View in log" (`MapView` → `/flights`).
- **Airport reconciliation**: `Service/AirportReconciliationService` wired into flight create/update/import plus a recheck-all action in Personal settings. See "Airport reconciliation" above.
- **Within-day ordering**: `day_seq` column + `FlightService::move` + `POST /api/v1/flights/{id}/move`, with up/down chevrons in `ViewFlightLog.vue`. Orders same-day legs without a trip concept or times. See "Within-day ordering" above.
- **Import / export** (Personal settings → "Import / Export", `views/PersonalSettings.vue`): two formats, both via `POST /api/v1/import` (`dataformat` `markdown`|`json`) and `GET /api/v1/export?dataformat=…`.
  - **Markdown** (legacy): lossy human-friendly table (`Date | Flight | Route | Type | Tail`), pasted into a textarea / downloaded as `.md`. `ImportService::importMarkdownTable` + `ExportService::exportMarkdownTable`.
  - **JSON** (backup/migrate): lossless round-trip of every column, file-upload restore / `.json` download. `ImportService::importJson` accepts the export envelope (`{app, version, exportedAt, flights:[…]}`) **or** a bare flight array; `ExportService::exportJson` writes the envelope (`JSON_FORMAT_VERSION`) carrying `day_seq`, `distance_km` and the `created_at`/`updated_at` timestamps in addition to the user-meaningful fields. Only the surrogate `id` is omitted (reassigned on restore). Rows go through `FlightService::restore` (not `create`): it validates, then **honours an explicit `day_seq`, distance and timestamps when present** (so a full backup restores exactly), otherwise deriving them as `create` does. A stored origin/destination code is passed through verbatim (a backup keeps its codes even on a reference-less instance); endpoints without a code are reconciled, and a non-null backup distance wins over the reconciled value (a null/absent one falls back to the reconciled/derived value). Per-row failures are collected into `skipped` (1-based index as `line`); malformed JSON / non-list `flights` returns HTTP 400.
    - **Handcrafting a JSON file**: put **IATA/ICAO codes in the label fields** (`originLabel`/`destinationLabel`) and leave the codes absent, then let reconciliation canonicalise on import — a code is always tier-1 resolvable, so it round-trips cleanly to the proper name + coordinates + distance. Avoid the trap of pairing a real `*Code` with a free-text label that isn't the reference name (e.g. `code "DUB"`, `label "Dublin"`): it imports fine, but the label can't re-resolve, so it only looks right until something refreshes it. The hybrid (see Airport reconciliation) keeps that case non-destructive on recheck, but a code-in-the-label file is the clean way to author one.
    - **Replace toggle**: JSON import takes an optional `replace` flag (`importJson($userId, $json, $replace)`). Off by default (append). When on, the user's existing flights are wiped via `FlightService::deleteAll` **after** the payload parses and structurally validates but **before** any row is inserted — so a malformed file can never destroy data it then fails to replace. The result adds a `deleted` count. The Personal-settings UI guards the toggle with a `showConfirmation` before sending. Markdown import is always append-only.
  - **Personal-settings layout** (`views/PersonalSettings.vue`): three `NcSettingsSection`s under a single wrapping `<div>` root (ESLint `vue/no-multiple-template-root`) — **Import / Export** (Import subheading: JSON file restore with the replace toggle as the primary path, a tertiary "Import from markdown…" button; Export subheading: Download JSON / Download markdown), **Maintenance** (currently just Reconcile airports; the home for future reference-data tools), and **Delete**. Subsection `<h3>`s are styled compact (16px bold) so they read as subordinate to the section title. The markdown paste area lives in an on-demand `NcDialog` (`markdownDialogOpen`, `size="large"`) rather than inline; `runImport` closes it on a successful response and surfaces the result `NcNoteCard` in the main view, keeping the pasted text when rows were skipped so it can be corrected and re-imported.
- **Map view** (`views/MapView.vue`, route `/map`, **lazy-loaded** to keep Leaflet out of the main chunk): Leaflet map with a **bundled GeoJSON basemap** (`world-atlas` TopoJSON → `topojson-client`) — no external tile server, no API keys, no CSP changes. Plots the user's flown airports as circle markers and flight legs as true great-circle arcs via `leaflet.geodesic` (`GeodesicLine`), which wraps the antimeridian natively. Known tradeoff: near-polar routes (e.g. Dubai–US west coast, great circle peaks ~88°N) flatten against the top because Leaflet's Web Mercator clamps above 85°N — accepted as the cost of geodesic accuracy. The raw `world-atlas` basemap data crosses the antimeridian (Russia/Fiji draw as full-width bands, Antarctica encircles the pole) — `mapUtils.prepareBasemap()` drops Antarctica and unwraps every ring's longitudes before rendering. Filter-aware via the shared `src/filters.ts` model: `?airport=<code>&airportDir=…` filters the displayed flights and shows a removable chip; `?airport=<code>` alone just focuses (centres on) that airport. Fetches every flown airport once on mount, then filters client-side — a `watch` on the route query redraws the overlay layer group without a remount (so clearing the chip works in place). Airport markers carry a popup with From / To / Both filter actions; flight arcs carry a hover tooltip (`A ↔ B N flights`) and a click popup offering the route filters that were actually flown — both directional options plus the bidirectional one when flown both ways, or just the single direction when one-way (directional options ordered oldest-flown-first). All popup actions apply the filter on the Map view itself. Airport coordinates come from `GET /api/v1/airports/by-codes` (`AirportApiController::byCodes`, backed by `AirportMapper::findByCodes`). Pure data prep (`src/mapUtils.ts`, `src/filters.ts`) is unit-tested; Leaflet rendering is not (jsdom limitation). The Airports view's row menu has a "Show `<code>` on map" entry.

### Milestone 1 explicit non-goals

Reference data seeding/autocomplete, map, analytics, enrichment, import/export, admin settings, units conversion UI, multi-leg trip grouping, departure/arrival times.

## Known scaffold quirks

- `composer.json` pins `nextcloud/ocp: dev-stable34` (the top of the supported range). The Psalm matrix (`psalm-matrix.yml`) is auto-derived from `appinfo/info.xml`'s `min/max-version` (currently 33–34) via the `nextcloud-version-matrix` action — no separate version list to maintain. The weekly `update-nextcloud-ocp-matrix.yml` job bumps the pin; its `target` must track the chosen dev version (`stable34`). `psalm.xml`'s `phpVersion` must equal the matrix's computed `php-min` (8.2 for NC 33) — enforced by a grep step in `psalm-matrix.yml`. Keep `composer.json` `php`/`platform.php` (8.2) aligned with that floor.
- **Dependabot npm major bumps gated by Nextcloud tooling peers.** Two bumps are parked, not mergeable: vite 7→8 (PR #16) and TypeScript 5→6 (PR #3). Both fail CI at `npm ci` with `ERESOLVE` — not a code issue. `@nextcloud/vite-config@2.5.2` hard-pins `vite: ^7.1.10`; `@nextcloud/eslint-config@8.4.2` hard-pins `typescript: ^5.0.2`. Bump those Nextcloud packages first; the vite/TS bumps follow only once their peer ranges widen. Don't force with `--legacy-peer-deps` (the org-templated `node.yml` workflow would also need editing, and edits there get overwritten).

## Testing

### Demo dataset (`tests/fixtures/`)

`demo-flights.json` is a ~200-leg JSON export (restorable via Personal settings → Import) produced by `generate_demo_flights.py`. **Names, coordinates and canonical codes are loaded from the reference airports JSON** (mwgg/Airports format, keyed by ICAO — the same data an admin imports), so every flight's `*Code`/`*Label`/`distance_km` is exactly what reconciliation produces: the fixture round-trips, edits don't corrupt it, and a recheck is a no-op. **Never hand-edit the fixture or reintroduce labels that disagree with their code** — a defective fixture self-corrupts on recheck and breaks the map. Regenerate with `python3 tests/fixtures/generate_demo_flights.py --airports /path/to/airports.json` (the reference JSON is not committed; the haversine radius matches `Service/GreatCircle.php`). The five deliberately-unmatched legs carry a `null` code on the unrecognised side (real un-reconciled shape) so they exercise the "Unmatched airports" filter.

### PHPUnit (backend)

Unit coverage lives under `tests/unit/Service/` (`FlightServiceTest`, `ImportServiceTest`, `ExportServiceTest`, `GreatCircleTest`). Wired up via `tests/phpunit.xml` and runnable through `composer test:unit` / `make test`. `tests/bootstrap.php` registers a PSR-4 prefix for `nextcloud/ocp` because that package ships stubs without its own autoloader — revisit if the OCP package starts autoloading itself or if tests start needing a real Nextcloud server bootstrap.

Still missing and worth adding once the API surface settles past Milestone 1:

- `Controller/FlightApiController` and `Controller/SettingsApiController` — happy-path + error-path per endpoint.
- Integration-style tests for `Db/FlightMapper` and migrations (need a real DB; currently out of scope for unit tests).

### Frontend (Vitest + type-check)

- **Type-check:** `npm run type-check` (`vue-tsc --noEmit`) is a gate — wired into `make lint`. It catches `@nextcloud/vue` v8→v9 prop/event mismatches. `src/shims-icons.d.ts` declares the `vue-material-design-icons/*.vue` modules (the package ships `.d.vue.ts` files but no `exports` map).
- **Component tests:** Vitest + `@vue/test-utils` under `tests/frontend/` (`*.spec.ts`), config in `vitest.config.ts`, shared mocks in `tests/frontend/setup.ts`. Run via `npm run test:frontend`, gated through `make test`. `@nextcloud/vue` is inlined (`server.deps.inline`) so Vite handles its CSS side-effect imports.
- **Add a component test for every new interaction-critical UI path** (form save, search, filter, destructive action). Test the wiring as a user drives it — stub heavy children but emit the real model event / click the real button so a wrong prop or event name fails the test. When mounting a real `@nextcloud/vue` component, mock `vue-router` with `importOriginal` so injected keys (`routerKey`) survive.
