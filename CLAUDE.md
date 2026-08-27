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
| `aircraft_type_code` | varchar(8), nullable | Canonical ICAO type designator (`B77W`, `B789`, `B38M`, `DHC6`). Set by aircraft reconciliation. |
| `aircraft_type_raw` | varchar(64), nullable | Verbatim user input ("B738-8 MAX"); preserved even after canonicalization. |
| `aircraft_manufacturer` | varchar(64), nullable | Reference manufacturer of the resolved model ("BOEING"). Denormalized by reconciliation. |
| `aircraft_model` | varchar(64), nullable | Reference model of the resolved row ("737-800"). Denormalized by reconciliation; the log's display value. |
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

### Aircraft reconciliation

`Service/AircraftReconciliationService::resolve(?string $input): ?AircraftMatch` resolves free-text aircraft input against `flightjournal_aircraft_types`. Exact and tiered, never fuzzy, mirroring the airport resolver:

1. ICAO type designator (case-insensitive) → that designator's **canonical** model.
2. Model name (case-insensitive; ignored if not unique — 1,034 model strings are shared across manufacturers).
3. The same model comparison against `model_normalized`, a stored key of just letters and digits (`Service/AircraftModelKey::normalize`, shared by the importer that writes it and the resolver that derives it from user input, so they can't drift). Lets "A320neo" reach DOC 8643's "A-320neo". Still exact and still uniqueness-guarded — normalising collapses only 5,988 → 5,982 distinct model keys, so it adds almost no ambiguity. It deliberately does **not** bridge a missing word: "787-9" still won't reach "787-9 Dreamliner", nor "A350-900" reach "A-350-900 XWB"; those need the designator (B789 / A359). Worth **101 → 175 legs** on the 200-leg demo fixture.

**Tier 3 is always on, and is strictly additive** — consulted only after both strict tiers return null, so it can never change a result that already resolved, only fill in a blank (pinned by two tests). Its failure mode is a *missing* match, never a wrong one: normalising two models onto one key makes that key ambiguous, and an ambiguous key resolves to nothing. It shipped briefly as an opt-in "Ignore punctuation" switch on the bulk recheck; that was removed because an option which can only help made the default the worse one, and because a recheck-only flag meant saves matched differently from rechecks.

No IATA tier: the column exists but the IATA overlay is deliberately not imported yet, so such a tier would always miss.

**Why the reference table is at model grain.** In DOC 8643 a designator maps to many models — 1,377 of 2,688 designators have more than one (B738 is both the 737-800 and the 737-800 BBJ2). Collapsing at import would discard exactly the rows a disambiguation UI needs, so every row is kept and one per designator is flagged `canonical`. `(manufacturer, model)` is the unique key because `model` alone fails to identify a row within its designator for 629 designators.

**Canonical ranking** (`AircraftTypeImportService::pickCanonical`) — two filters, then a sort:

1. **Digit containment.** A designator encodes its model number (B737 → 737-700, A332 → A3**3**0-**2**00, B738 → 737-**8**00), so keep only models whose digits contain the designator's digits as an **ordered subsequence**. Subsequence, not substring: "332" is not a substring of "330200" but is a subsequence — exactly the A332 case. Vacuous for letter-only designators (GLID, BALL).
2. **Derivative demotion.** Drop `BBJ|ACJ|Prestige|Lineage|VIP|Elite|Challenger|CC-|UV-|P-72` (83 of 7,388 rows).
3. **Shortest model name**, then 4. **alphabetical by `(manufacturer, model)`**.

Both filters share one invariant: **they never eliminate every candidate** — a filter that would empty the set is skipped for that designator (digits find nothing for 15 designators, all-derivative for 4). Filter order is load-bearing for exactly one designator: `CC11` gives "CC-11 Sport Cub" digits-first but "CCK-1865 Carbon Cub" demote-first, because `CC-` (added for the CC-138 Twin Otter) falsely flags Cub Crafters — digits-first neutralises it.

The alphabetical tiebreak is not cosmetic: shortest-model alone ties in 685 of the 1,377 ambiguous designators, so without it the pick would follow file order and could silently flip between imports. Verified: 0 of 2,688 picks change when the input is shuffled.

Scored against the OpenFlights name list (the ~230 types passengers actually fly) as an independent oracle, the digit filter lifts correct picks from **102/157 to 132/157, with 30 improved and 0 regressed**; it changes 243 of 1,377 multi-model designators overall. Still imperfect — E190 lands on the bare "190" because both it and "ERJ-190-100" carry the digits — which is why the model is meant to be overridable per flight rather than baked in. **Changing this rule requires a re-import to take effect**, and is safe for user data: `reconcileAircraftAll` preserves a stored model that differs from the canonical one.

**Divergence from airports on preservation:** an airport label is *overwritten* with the reference name on a match; `aircraft_type_raw` is **always preserved**. The resolved model lands in its own `aircraft_manufacturer` / `aircraft_model` columns alongside it.

**Denormalized, and by natural key.** Reconciliation copies the resolved manufacturer/model onto the flight (as airport reconciliation copies the airport name into `origin_label`), keeping the list endpoint join-free. Stored as the natural key rather than a reference id, because surrogate ids don't survive a re-import and are meaningless in a JSON backup restored on another instance.

Reconciliation runs in the same four places as airports, all through the one resolver:

1. **New flight** — `FlightService::create` resolves `aircraftTypeRaw`.
2. **Edit flight** — `resolveAircraftForUpdate` re-resolves **only when the raw text actually changed**. Same reasoning as `resolveEndpointForUpdate`: otherwise an unrelated edit (the seat) could clear a valid type whose stored text isn't itself resolvable. An edited value that fails to resolve still clears the stale code, as intended.
3. **Bulk import** — via `FlightService::create` / `restore`. A backup's explicit code + manufacturer + model are honoured verbatim, so a restore is faithful on an instance with no reference data.
4. **Recheck-all** — `FlightService::reconcileAircraftAll` + `POST /api/v1/flights/reconcile-aircraft` (scope `missing` | `all`), from Personal settings → Maintenance. **`missing` means missing reference data, not merely missing a code**: a row is skipped only when its designator, manufacturer *and* model are all present. Keying on the code alone stranded rows that carry a designator with no manufacturer/model — a JSON restore honours a stored code verbatim without resolving it, so those rows fall back to the raw text in the Aircraft column while every default run skips them and still reports success. All three matter because the column renders manufacturer and model together via `aircraftName()`. Follows the same hybrid: a flight with a designator is refreshed *from that designator* (`resolveDesignator`, which deliberately does **not** fall through to the model-name tier), and a failed lookup leaves it untouched rather than clearing a valid code. A stored model differing from its designator's canonical model is treated as explicitly chosen and preserved while the code is still canonicalised.

The Edit-flight dropdown to override a designator's canonical model is **not built yet**. It needs a public `findByDesignator` on the mapper (the private `byDesignator(…, canonicalOnly: false)` already returns the right rows, canonical first), an endpoint to serve the option list, and `aircraftManufacturer`/`aircraftModel` added back into `FlightInput`. `reconcileAircraftAll` already preserves an explicitly chosen model, so the recheck won't undo the choice once it exists.

**Editor input** (`components/AircraftTypeField.vue`, in both `EditFlightLog` and `AddFlightDialog`): a text field that *gains* a type-ahead over the reference data — never a select that requires it, so the free-text path keeps working on an instance with no aircraft data ("never block on enrichment"). Two ways in:

- **Free text** → the form sends null codes and the server reconciles on save, exactly as before.
- **A pick** → sets an `AircraftSelection` (`{code, manufacturer, model}`), which `withAircraftSelection()` folds into the payload; `FlightService::resolveAircraft` then honours it verbatim via the same explicit-code branch a JSON restore uses. No new backend was needed for this.

**A pick never overwrites `aircraft_type_raw`.** This is where aircraft diverges from airports: `resolveEndpoint` replaces `origin_label` with the reference airport name because there are only two columns and the name has nowhere else to go. Aircraft has four, so the reference values already have dedicated homes — overwriting `raw` would duplicate one string across two columns and destroy the only record of what the user typed. That record is what makes a JSON round-trip, a reference re-import with a different canonical ranking, and a future bulk "fix every leg that says X" all possible.

**`aircraftSelection` is null on load, by design.** Pre-filling it from the stored code would resurrect the stale-code bug (an explicit client code makes the backend skip re-reconciling an edited entry). A stored pick still survives an unrelated edit, because `resolveAircraftForUpdate` preserves the whole stored triple when the raw text is unchanged. Editing the text clears an active pick — it described a different string.

The component is standalone rather than inline so a future bulk-update dialog can mount it and get the same `AircraftSelection` to apply across many flights.

`AircraftTypeMapper::applySearch` also matches `model_normalized`, so the type-ahead finds what reconciliation finds ("A320neo" → "A-320neo"); without it the suggestion list would be strictly less capable than the field it sits on.

**Editor feedback** (`components/AircraftResolution.vue`, rendered by `AircraftTypeField` whenever no pick is active): a read-only line under the Aircraft type field reporting what the *current* text resolves to — matched designator + model, "no reference match", or "no reference data on this instance". It re-resolves as you type (debounced 300 ms, with a token guard so a slow early reply can't overwrite a newer one) rather than reporting the flight's stored result, because the workflow it serves is fixing an entry that didn't resolve and a stale badge would keep saying "no match" while you type the fix. It calls `GET /api/v1/aircraft-types/resolve` — which exists so the preview runs the **server's** tiers; any client-side approximation would drift from them and promise a match that never happens. The endpoint returns `referenceLoaded` alongside a null match so an empty reference table reads differently from a genuine miss. It deliberately ignores the flight's stored manufacturer/model, which can differ from a fresh resolve when a model was explicitly chosen — reconciling that belongs with the override UI that creates it.

**Display is reference-first** everywhere: `aircraftDisplay()` in `src/types.ts` returns `aircraftName(manufacturer, model) ?? aircraftTypeRaw ?? aircraftTypeCode`, i.e. "BOEING 737-800" rather than "B738" or the typed "738". Shared by the log table cell, its sort key, `filters.ts` matching and the `FilterPicker` option list so they can never disagree. Note this is the opposite fallback order from the route column (code-first) — deliberate, so the resolved (or user-chosen) type is what the log shows.

`aircraftName()` is factored out because the **flights filter matches on this exact string**, so anything that links *into* a filtered flights view must spell a reference row identically: the Aircraft types row menu (`ViewAircraftTypes.showFlights`) and the type-ahead's option/pick labels all go through it. A second copy of that join would drift and silently produce links matching nothing.

**The markdown export deliberately does *not* mirror the column** — it stays model-only (`getAircraftModel() ?? raw ?? code`). Markdown is re-importable, and its aircraft string lands in `aircraft_type_raw` to be reconciled; "737-800" resolves on tier 2 but "BOEING 737-800" matches no tier, so mirroring the UI would break the round-trip.

### Reference (instance-wide, no `user_id`)

- `flightjournal_airports` — `iata`, `icao`, `name`, `city`, `state`, `country_iso2`, `lat`, `lon`, `elevation` (feet, integer), `tz`, `source`, `updated_at`.
- `flightjournal_aircraft_types` — **one row per aircraft model, not per designator**: `icao_code` (indexed, *not* unique — it groups models), `manufacturer` + `model` (the unique natural key), `iata_code`, `engine_type`, `engine_count`, `wtc`, `description`, `canonical`, `source`, `updated_at`. See "Aircraft reconciliation" below for why the grain is the model.
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
2. Bundled reference-data seed + autocomplete in editor. *(Done for aircraft: admin CSV import, reconciliation, and a type-ahead in the flight editor that can override the canonical model. Airports are admin-imported but the editor still has no airport autocomplete — that is the remaining half of this item.)*
3. Rich View flight log table (sort/filter/pagination).
4. Map view (Leaflet).
5. Analytics view (great-circle distances from cached coordinates; Chart.js).
6. Enrichment providers (weather first); admin settings screen for API keys.
7. Import/export in personal settings.

## Open items

Recorded for priority review; nothing here is in progress.

### Aircraft data epic — remaining

- **Sorting the reference views by column, including the flight count.** Agreed four-step plan; step 1 (counts displayed) has landed. Remaining: (2) extract `ViewFlightLog`'s sort machinery into something shared, (3) client-side sorting for the flown-only mode, (4) server-side sorting for "Show all" — only if wanted. See the sorting note under "Flight counts on the reference views" for why the mode split exists.
- **IATA overlay** ([OpenFlights planes.dat](https://openflights.org/data.php), ~232 designators, ODbL). Needs no migration — `iata_code` already exists and stays NULL. Unblocks two things at once: the IATA column is currently *hidden* in `ViewAircraftTypes` because it would be blank on every row, and the OpenFlights names are the most plausible lever for the E190 ranking wart below.
- **E190 resolves to the bare "190".** Both it and "ERJ-190-100" carry the designator's digits, so the shortest-name rule picks the barer one. Not fixable by digit matching; see "Canonical ranking".

### Test debt, ordered by evidence of harm

- **Nothing exercises mappers or migrations.** Both production failures — the migration that never ran (missing version bump) and `engine_type` declared too narrow for "Turboprop/Turboshaft" — were in this blind spot, and neither is reachable by a mocked-mapper unit test. Highest-value gap in the suite. Would also cover the aggregate SQL that a server-side flight count would need.
- **Controller tests cover only `FlightApiController`.** Added after it silently dropped `aircraftManufacturer`/`aircraftModel`. `SettingsApiController`, `AircraftTypeApiController` and both admin controllers share the same explicit-parameter-list shape and have none.
- **Test files are not type-checked** — `tsconfig.json` includes only `src/`. Fixture objects have drifted from `Flight` twice, with assertions passing by accident. Adding `tests/` would have caught both for free.
- **No test pins the markdown export as model-only.** It deliberately diverges from the Aircraft column (which shows "MANUFACTURER Model") because mirroring it would break the markdown round-trip — "BOEING 737-800" matches no reconciliation tier. Nothing currently stops someone "fixing" that inconsistency.

### Feature backlog

- **Bulk update**, including fixing many unmatched aircraft at once. `AircraftTypeField` was built standalone specifically so a bulk dialog can mount it and get one `AircraftSelection` to apply across N flights, and keeping `aircraft_type_raw` is what makes "fix every leg that says X" possible.

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
- **Airport browse view**: read-only `views/ViewAirports.vue` (route `/airports`, in the SPA navigation), backed by `Controller/AirportApiController` `GET /api/v1/airports` (paginated, searchable on icao/iata/name/city). Each row has a three-dot menu ("Show flights to / from / to and from `<code>`") that navigates to the Flights view with an airport filter applied. The search box is **seeded from `?q=`** on setup, which is how the Map view's marker popup drills through to one airport ("View `<code>` details"). Read once rather than watched: typing in the box deliberately does not write back to the URL, so nothing can change the query while the view is mounted. The flown-only default needs no override for that drill-through — the map's markers and this view's flown list are both derived from the user's flight codes intersected with reference rows, so any airport clickable on the map is a row in the default mode.
- **Aircraft type browse view**: read-only `views/ViewAircraftTypes.vue` (route `/aircraft-types`, in the SPA navigation), backed by `Controller/AircraftTypeApiController` `GET /api/v1/aircraft-types` (paginated, searchable on designator/iata/manufacturer/model). Mirrors the Airports view including the flown-only default and its "Show all" switch.
  - **"Flown" means the exact (manufacturer, model) pair**, via `FlightMapper::findFlownAircraftModels`. The governing rule: *a row belongs in the flown list only if its own "Show flights on …" action returns at least one flight.* That action filters on the row's displayed name and the flights filter matches `aircraftDisplay` — i.e. "MANUFACTURER Model" — so the pair is the only restriction that satisfies it. This replaced an earlier designator-based restriction, which listed every sibling model sharing a designator: 41 rows for 21 flown models on the demo dataset, the padding being BBJ/ACJ conversions and military variants (including the VC-25B) whose menu action led to an empty screen. Sibling variants are what the "Show all aircraft types" toggle is for. Rows are ordered `icao_code, canonical DESC, manufacturer, model` so variants read as belonging to their designator, and the canonical one carries a "default" badge.
  - **Half-reconciled flights (a code but no manufacturer/model) contribute nothing** to the flown list, by the same rule — they display as their raw text, so no reference row's link would match them. They surface instead under the Flights view's `unmatchedAircraft` filter, and are repaired by a recheck; see the `missing` scope note under "Aircraft reconciliation".
  - **The row menu links by model, not designator** — the aircraft filter matches on the Aircraft column's *displayed* value (`aircraftDisplay`), which for a reconciled leg is the model. Both sides are upper-cased (`csvParam` / `distinctCodes`), so case doesn't matter, but sending the designator would match nothing.
- **Flight counts on the reference views** (`src/flightCounts.ts`): both browse views show a "Flights" column, counted **client-side from the Pinia flights store** rather than aggregated in SQL. The reason is correctness, not laziness: each count is keyed by the very value the corresponding filter matches on — `aircraftDisplay(f)` for aircraft, the canonical airport code for airports — so the number shown *is* how many flights that row's own "Show flights…" action returns, by construction rather than by two implementations agreeing. The store is usually warm (Flights is the default route); the views fetch only when `loaded` is false. A leg counts once per *distinct* airport endpoint, so a same-airport leg counts once, matching the "to and from" filter. Half-reconciled legs land under their raw text, not under the reference row they half-point at — again matching what the filter would return. Viable because a personal journal holds hundreds to low thousands of flights; it would need revisiting in the tens of thousands.
  - **Headline summary line** under each view's title ("20 visited / 25,000 total", "13 flown / 7,000 total"), styled like the Flights view's `.filter-count` (`--color-text-maxcontrast`). Unlike the per-row counts these two numbers come from the **server**, as two `limit=1` list calls (flown-only and all) issued once on mount: each is by definition the size of the list its own "Show all" mode renders, so a flown code with no reference row is in neither and the summary can't disagree with the list underneath it. Deliberately independent of the search box and the toggle — the pager already reports what the current query returns.
  - **Sorting these views by column, including the count, is the planned next step** and is *not* a client-side change: both views paginate server-side, so sorting has to precede pagination. Count-sorting is only meaningful over the flown set (in "Show all", ~29k of 29k airports have a count of 0), and that set is small enough to load whole — so the likely shape is flown-only sorted entirely client-side, reusing `ViewFlightLog`'s existing `SortKey`/`sortValue`/`.sort-button` machinery, with "Show all" staying server-paginated and sorted on reference columns only.
- **View filtering** (`src/filters.ts`): the filter model is shared by the Flights and Map views so both interpret the route query identically. `buildFilters(query)` → `ActiveFilter[]` (each with `id`, `label`, `queryKeys`, `matches`); `applyFilters(flights, filters)` applies them (AND). The airport filter uses query keys `airport` + `airportDir` (`to` | `from` | `either`) — **both** are required; `airport` alone is only a Map focus hint, not a filter. The single-flight filter uses query key `flight` (an id) — set by the "View on map" item in each flight's row menu. The route filter uses `routeA` + `routeB` + `routeDir` (`ab` directional | `both`) — set by the arc popup on the Map view. Three toggle filters (set by the `FilterPicker` menu, query value `1`) carry no editor: `unmatchedAirports` matches legs missing either airport `_code`; `unmatchedAircraft` matches legs with no `aircraftTypeCode`; and `multiday` matches legs on any date with more than one flight (offered only when such a day exists; its multi-day set is derived from the full list, so it keeps whole days intact — and `ViewFlightLog` therefore still allows within-day reordering when `multiday` is the *only* active filter). Both round-trip to the Map view like every other filter (shared model + the cross-view buttons carry the full query). On the Map the `unmatched` filter simply shows no arcs — partial legs need both endpoints to draw a line — but any *matched* endpoint of those legs still plots as a marker, a deliberate visual cue for spotting data to fix. The two "Unmatched …" items are each gated on **their own** reference table being non-empty, probed once on mount via `Promise.allSettled([listAirports, listAircraftTypes])` — the tables are imported independently, so one loaded table must not light up the other's filter, and a failing probe must not take the other down with it. `unmatchedAircraft` matches `!f.aircraftManufacturer || !f.aircraftModel` — every leg whose Aircraft column cannot show "MANUFACTURER Model". That deliberately covers three shapes as one worklist: nothing entered, entered but unresolved, and **half-reconciled** (a designator with no manufacturer/model, which a JSON restore produces by honouring a stored code without resolving it). It was previously keyed on `!f.aircraftTypeCode`, which missed that third shape entirely — those legs have a code, so they were invisible here *and* excluded from the Aircraft types flown list, with nothing anywhere to reveal them. Keying on the pair also makes the two views agree on what "resolved" means. The aircraft filter's `[blank]` sentinel still isolates the entered-nothing case alone. The airport key was renamed from the bare `unmatched` to `unmatchedAirports` in 1.0.8 for symmetry — a filter URL saved before that no longer applies the filter (it is ignored, not mis-applied).

New filter types extend `buildFilters()`; the chip row and clearing are generic over the shape. Both views show removable `NcChip`s for the active filter plus a reciprocal cross-view button that carries the query across — "View on map" (`ViewFlightLog` → `/map`) and "View in log" (`MapView` → `/flights`).
- **Airport reconciliation**: `Service/AirportReconciliationService` wired into flight create/update/import plus a recheck-all action in Personal settings. See "Airport reconciliation" above.
- **Aircraft type reference + reconciliation**: `Db/AircraftType` + `AircraftTypeMapper`, `Service/AircraftTypeImportService` (DOC 8643 CSV, taken verbatim as downloaded from [ColtJD45/icao-aircraft-designator-list](https://github.com/ColtJD45/icao-aircraft-designator-list); header mapped by name, column order free), `Controller/AircraftTypeAdminApiController` exposing `POST /api/v1/admin/aircraft-types/import`, `DELETE /api/v1/admin/aircraft-types`, `GET /api/v1/admin/aircraft-types/count`. Admin-only. Plus `Service/AircraftReconciliationService` + `Migration\Version0004…`. See "Aircraft reconciliation" above.
  - **Admin settings is now generic over reference tables**: `components/ReferenceDataSection.vue` owns count/import/delete for one table, parameterised by a `basePath` whose three endpoints it derives; `views/AdminSettings.vue` mounts it twice and supplies format guidance via the `instructions` slot. Slot content is compiled in the parent's scope, so the slotted note styling lives in `AdminSettings.vue`, not the child.
  - **IATA codes are deferred**, not forgotten: `iata_code` exists and stays NULL. The overlay source would be [OpenFlights planes.dat](https://openflights.org/data.php) (~232 designators with both codes, ODbL — attribution + share-alike on the derived database). Adding it needs no migration.
  - **Reference data is admin-imported, never committed** — same call as the airports JSON, and it also sidesteps redistributing DOC 8643 in a published app package (the MIT label on the scrape covers the packaging, not ICAO's rights in the underlying data).
- **Within-day ordering**: `day_seq` column + `FlightService::move` + `POST /api/v1/flights/{id}/move`, with up/down chevrons in `ViewFlightLog.vue`. Orders same-day legs without a trip concept or times. See "Within-day ordering" above.
- **Import / export** (Personal settings → "Import / Export", `views/PersonalSettings.vue`): two formats, both via `POST /api/v1/import` (`dataformat` `markdown`|`json`) and `GET /api/v1/export?dataformat=…`.
  - **Markdown** (legacy): lossy human-friendly table (`Date | Flight | Route | Type | Tail`), pasted into a textarea / downloaded as `.md`. `ImportService::importMarkdownTable` + `ExportService::exportMarkdownTable`.
  - **JSON** (backup/migrate): lossless round-trip of every column, file-upload restore / `.json` download. `ImportService::importJson` accepts the export envelope (`{app, version, exportedAt, flights:[…]}`) **or** a bare flight array; `ExportService::exportJson` writes the envelope (`JSON_FORMAT_VERSION`) carrying `day_seq`, `distance_km` and the `created_at`/`updated_at` timestamps in addition to the user-meaningful fields. Only the surrogate `id` is omitted (reassigned on restore). Rows go through `FlightService::restore` (not `create`): it validates, then **honours an explicit `day_seq`, distance and timestamps when present** (so a full backup restores exactly), otherwise deriving them as `create` does. A stored origin/destination code is passed through verbatim (a backup keeps its codes even on a reference-less instance); endpoints without a code are reconciled, and a non-null backup distance wins over the reconciled value (a null/absent one falls back to the reconciled/derived value). Per-row failures are collected into `skipped` (1-based index as `line`); malformed JSON / non-list `flights` returns HTTP 400.
    - **Handcrafting a JSON file**: put **IATA/ICAO codes in the label fields** (`originLabel`/`destinationLabel`) and leave the codes absent, then let reconciliation canonicalise on import — a code is always tier-1 resolvable, so it round-trips cleanly to the proper name + coordinates + distance. Avoid the trap of pairing a real `*Code` with a free-text label that isn't the reference name (e.g. `code "DUB"`, `label "Dublin"`): it imports fine, but the label can't re-resolve, so it only looks right until something refreshes it. The hybrid (see Airport reconciliation) keeps that case non-destructive on recheck, but a code-in-the-label file is the clean way to author one.
    - **Replace toggle**: JSON import takes an optional `replace` flag (`importJson($userId, $json, $replace)`). Off by default (append). When on, the user's existing flights are wiped via `FlightService::deleteAll` **after** the payload parses and structurally validates but **before** any row is inserted — so a malformed file can never destroy data it then fails to replace. The result adds a `deleted` count. The Personal-settings UI guards the toggle with a `showConfirmation` before sending. Markdown import is always append-only.
  - **Personal-settings layout** (`views/PersonalSettings.vue`): three `NcSettingsSection`s under a single wrapping `<div>` root (ESLint `vue/no-multiple-template-root`) — **Import / Export** (Import subheading: JSON file restore with the replace toggle as the primary path, a tertiary "Import from markdown…" button; Export subheading: Download JSON / Download markdown), **Maintenance** (currently just Reconcile airports; the home for future reference-data tools), and **Delete**. Subsection `<h3>`s are styled compact (16px bold) so they read as subordinate to the section title. The markdown paste area lives in an on-demand `NcDialog` (`markdownDialogOpen`, `size="large"`) rather than inline; `runImport` closes it on a successful response and surfaces the result `NcNoteCard` in the main view, keeping the pasted text when rows were skipped so it can be corrected and re-imported.
- **Map view** (`views/MapView.vue`, route `/map`, **lazy-loaded** to keep Leaflet out of the main chunk): Leaflet map with a **bundled GeoJSON basemap** (`world-atlas` TopoJSON → `topojson-client`) — no external tile server, no API keys, no CSP changes. Plots the user's flown airports as circle markers and flight legs as true great-circle arcs via `leaflet.geodesic` (`GeodesicLine`), which wraps the antimeridian natively. Known tradeoff: near-polar routes (e.g. Dubai–US west coast, great circle peaks ~88°N) flatten against the top because Leaflet's Web Mercator clamps above 85°N — accepted as the cost of geodesic accuracy. The raw `world-atlas` basemap data crosses the antimeridian (Russia/Fiji draw as full-width bands, Antarctica encircles the pole) — `mapUtils.prepareBasemap()` drops Antarctica and unwraps every ring's longitudes before rendering. Filter-aware via the shared `src/filters.ts` model: `?airport=<code>&airportDir=…` filters the displayed flights and shows a removable chip; `?airport=<code>` alone just focuses (centres on) that airport. Fetches every flown airport once on mount, then filters client-side — a `watch` on the route query redraws the overlay layer group without a remount (so clearing the chip works in place). Airport markers carry a popup with From / To / Both filter actions plus "View `<code>` details", the one action that *leaves* the Map view (to `/airports?q=<code>`, resolved by that view's search); flight arcs carry a hover tooltip (`A ↔ B N flights`) and a click popup offering the route filters that were actually flown — both directional options plus the bidirectional one when flown both ways, or just the single direction when one-way (directional options ordered oldest-flown-first). All popup actions apply the filter on the Map view itself. Airport coordinates come from `GET /api/v1/airports/by-codes` (`AirportApiController::byCodes`, backed by `AirportMapper::findByCodes`). Pure data prep (`src/mapUtils.ts`, `src/filters.ts`) is unit-tested; Leaflet rendering is not (jsdom limitation). The Airports view's row menu has a "Show `<code>` on map" entry.

### Milestone 1 explicit non-goals

Reference data seeding/autocomplete, map, analytics, enrichment, import/export, admin settings, units conversion UI, multi-leg trip grouping, departure/arrival times.

## Known scaffold quirks

- `composer.json` pins `nextcloud/ocp: dev-stable34` (the top of the supported range). The Psalm matrix (`psalm-matrix.yml`) is auto-derived from `appinfo/info.xml`'s `min/max-version` (currently 33–34) via the `nextcloud-version-matrix` action — no separate version list to maintain. The weekly `update-nextcloud-ocp-matrix.yml` job bumps the pin; its `target` must track the chosen dev version (`stable34`). `psalm.xml`'s `phpVersion` must equal the matrix's computed `php-min` (8.2 for NC 33) — enforced by a grep step in `psalm-matrix.yml`. Keep `composer.json` `php`/`platform.php` (8.2) aligned with that floor.
- **Dependabot npm major bumps gated by Nextcloud tooling peers.** Two bumps are parked, not mergeable: vite 7→8 (PR #16) and TypeScript 5→6 (PR #3). Both fail CI at `npm ci` with `ERESOLVE` — not a code issue. `@nextcloud/vite-config@2.5.2` hard-pins `vite: ^7.1.10`; `@nextcloud/eslint-config@8.4.2` hard-pins `typescript: ^5.0.2`. Bump those Nextcloud packages first; the vite/TS bumps follow only once their peer ranges widen. Don't force with `--legacy-peer-deps` (the org-templated `node.yml` workflow would also need editing, and edits there get overwritten).

## Testing

### Demo dataset (`tests/fixtures/`)

`demo-flights.json` is a ~200-leg JSON export (restorable via Personal settings → Import) produced by `generate_demo_flights.py`. **Both reference datasets are loaded from the real files an admin imports** — airports from the mwgg/Airports JSON, aircraft from the DOC 8643 CSV — so every flight's `*Code`/`*Label`/`distance_km` and its aircraft designator/manufacturer/model are exactly what reconciliation produces: the fixture round-trips, edits don't corrupt it, and a recheck is a no-op. **Never hand-edit the fixture or reintroduce values that disagree with the reference** — a defective fixture self-corrupts on recheck and breaks the map. Regenerate with:

```
python3 tests/fixtures/generate_demo_flights.py \
  --airports /path/to/airports.json --aircraft-types /path/to/icao_aircraft_data.csv
```

Neither reference file is committed; the script errors clearly if either is missing. Two pieces of logic are duplicated from PHP and must be kept in step: the haversine radius matches `Service/GreatCircle.php`, and `_canonical()` matches `AircraftTypeImportService::pickCanonical`.

**Deliberate gaps** exercise the "unmatched" filters and give the editor something real to fix:

- **Airports:** five legs carry a `null` code on the unrecognised side.
- **Aircraft:** `NEAR_MISS` holds plausible shorthand the reference does *not* contain, grouped by failure shape — a manufacturer prefix (`B737-800` vs `737-800`), a trailing marketing word (`787-9` vs `787-9 Dreamliner`), a trailing programme name (`A350-900` vs `A-350-900 XWB`). `NEAR_MISS_PER_SHAPE` legs of each are converted in a **deterministic post-pass, not by probability**: only ~26 legs use a near-miss-capable designator at all, so chance regularly dropped an entire shape and a reseed could silently remove one. A further `NO_AIRCRAFT_RATE` of legs record no aircraft at all. Current split: 187 resolved / 8 near-miss / 5 empty.

**The "typed" text is not always the model name.** `load_aircraft_reference` prefers the canonical model as the raw value for realism, but falls back to the designator when that model is ambiguous across manufacturers (E190's canonical model is the bare `190`) or is itself a designator — either would resolve somewhere other than the intended row, leaving a flight whose stored triple contradicts its own text.

### PHPUnit (backend)

Unit coverage lives under `tests/unit/Service/` (`FlightServiceTest`, `ImportServiceTest`, `ExportServiceTest`, `GreatCircleTest`, `AircraftTypeImportServiceTest`, `AircraftReconciliationServiceTest`). Wired up via `tests/phpunit.xml` and runnable through `composer test:unit` / `make test`. `tests/bootstrap.php` registers a PSR-4 prefix for `nextcloud/ocp` because that package ships stubs without its own autoloader — revisit if the OCP package starts autoloading itself or if tests start needing a real Nextcloud server bootstrap.

Still missing and worth adding once the API surface settles past Milestone 1:

- `Controller/SettingsApiController` — happy-path + error-path per endpoint.

`tests/unit/Controller/FlightApiControllerTest` covers create/update. Worth keeping: the controller declares its inputs as an **explicit typed parameter list** fed to `compact()`, so a field added to the entity, the service and the client but not to that list is silently dropped and the save still reports success. That is precisely how `aircraftManufacturer`/`aircraftModel` went missing after the type-ahead landed. The tests assert the *whole* payload reaches the service rather than spot-checking fields, so the next such omission fails immediately.
- Integration-style tests for `Db/FlightMapper` and migrations (need a real DB; currently out of scope for unit tests).

### Frontend (Vitest + type-check)

- **Type-check:** `npm run type-check` (`vue-tsc --noEmit`) is a gate — wired into `make lint`. It catches `@nextcloud/vue` v8→v9 prop/event mismatches. `src/shims-icons.d.ts` declares the `vue-material-design-icons/*.vue` modules (the package ships `.d.vue.ts` files but no `exports` map).
- **Component tests:** Vitest + `@vue/test-utils` under `tests/frontend/` (`*.spec.ts`), config in `vitest.config.ts`, shared mocks in `tests/frontend/setup.ts`. Run via `npm run test:frontend`, gated through `make test`. `@nextcloud/vue` is inlined (`server.deps.inline`) so Vite handles its CSS side-effect imports.
- **Add a component test for every new interaction-critical UI path** (form save, search, filter, destructive action). Test the wiring as a user drives it — stub heavy children but emit the real model event / click the real button so a wrong prop or event name fails the test. When mounting a real `@nextcloud/vue` component, mock `vue-router` with `importOriginal` so injected keys (`routerKey`) survive. `AdminSettings.spec.ts` covers both reference tables through the shared `ReferenceDataSection`; since one component drives both, its assertions are mostly that each instance is aimed at *its own* endpoints — a wrong `basePath` would import aircraft into the airport table or wipe the wrong one.
