---
paths:
  - "lib/**"
  - "tests/unit/**"
---

# Backend

## Backend layout (`lib/`)

- `AppInfo/Application.php` — DI registration, listeners.
- `Controller/` — thin HTTP layer. SPA shell via `PageController`; JSON APIs via `OCSController` subclasses (`FlightApiController`, later `ReferenceApiController`, `EnrichmentApiController`, `SettingsApiController`).
- `Service/` — business logic. Controllers stay dumb; services own validation, user-scoping, enrichment orchestration.
- `Db/` — `Entity` + `QBMapper` per table. All user-data queries scoped on `user_id` inside the mapper, never trusted from the client.
- `Migration/` — versioned schema migrations (`Version000XDate…`).
- `BackgroundJob/` — `TimedJob`s for enrichment refresh and reference-data refresh (added in later milestones).
- `Settings/` — `IPersonalSection` + `IPersonal` (and later `IAdminSection` + `IAdmin` for API keys).

## Data model

## Core: `flightjournal_flights` (one row per leg)

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

**Validation:** date, origin, and destination are all required (origin/destination satisfied by either `_code` or `_label`). Everything else optional. The date must be a real calendar date (`checkdate`, not just the `YYYY-MM-DD` shape), and every varchar value must fit its column (`FlightService::MAX_LENGTHS`, in characters after trimming; bulk update checks the same table). **SQLite enforces neither** — `2026-02-31` and a 9-character airline code store fine there, so CI never sees them — while MySQL (strict) and PostgreSQL reject the statement. Widen a column in a migration → update `MAX_LENGTHS` with it. `restore` also range-checks the backup-only numbers that land in 32-bit `INTEGER` columns (`daySeq` ≤ INT max, `distanceKm` 0…INT max), so an out-of-range backup row is a skip, not a database error that aborts the import.

**No FKs to reference tables** — flights remain valid even if reference data is missing or stale. This is a hard design principle: the app must be fully usable without enrichment.

**Origin/destination UX:** the Add and Edit screens expose a single "Origin" / "Destination" text field each, bound to `origin_label` / `destination_label`. The `origin_code` / `destination_code` columns are populated by airport reconciliation (see `.claude/rules/airports.md`). The Flights view route column displays `_code` when present, falling back to `_label`.

## Within-day ordering

When a user flies more than one leg on a given `flight_date`, `day_seq` records the order without introducing a "trip"/multi-leg concept or any departure/arrival times (still a non-goal). The value is **purpose-built and display-independent**: only its order relative to the other legs of the same `(user_id, flight_date)` is meaningful — gaps and absolute values are irrelevant, so deletes never renumber.

- **Assignment is automatic.** `FlightService::create` appends each new leg to the end of its day (`day_seq = FlightMapper::maxDaySeqForDate(user, date) + 1`); the first leg of a day gets 1. Import goes through `create`, so a bulk import is sequenced in file order. `update` only re-sequences when `flight_date` itself changes (re-appends to the new day, leaving the old day's gap); editing any other field never touches order. The user never sees or types the number.
- **Correction is a one-step swap.** `FlightService::move(id, user, 'earlier'|'later')` swaps `day_seq` with the adjacent same-day leg (no-op at the day's edge), exposed as `POST /api/v1/flights/{id}/move`. Direction is expressed in **day order, not screen position**: `earlier` = toward leg 1 (lower `day_seq`), `later` = away from it. The endpoint returns only the moved leg, so the store re-fetches to keep the swapped neighbour in sync. **The swap is one transaction over a locked day**: `FlightMapper::findDayForUpdate` reads every leg of the day `FOR UPDATE` (NC 33+, the app's floor), and the neighbour is taken from that list. Overlapping moves are real even from one tab — Nextcloud releases the PHP session before the controller runs unless a method has `#[UseSession]`, which none here do — so without the lock two quick clicks could both swap from the same stale order. **Ties heal on move:** legs sharing a `day_seq` (a restored backup may carry duplicates; `create` can still race into one) could never be swapped apart, so a move that meets a tie first renumbers the day `1..N` in its current order (rewriting only legs whose value changes). `create` is deliberately not locked: a day with no legs has no rows to lock on PostgreSQL, and a tie it produces is now repairable by the next move.
- **Sort follows the day direction.** `FlightMapper::findAllForUser` orders `flight_date DESC, day_seq DESC, id DESC` — all three keys move in lockstep, so the newest day's *last* leg sits on top (and an oldest-first view leads with the oldest day's *first* leg). The Flights view mirrors this client-side: its date sort uses `day_seq` as the same-direction within-day tiebreak.
- **Frontend (`ViewFlightLog.vue`):** up/down chevrons appear only on rows of a multi-leg day, and only in the natural date-sorted, unfiltered view (otherwise the visual neighbour isn't the day-order neighbour). The view owns the one sort-direction-dependent fact — which way the arrow points — translating the chevron into `earlier`/`later` based on the active date sort direction (newest-first → up = `later`). While a move is pending (`store.moving`, until its refetch lands) a further move is **ignored, not disabled** — the rows on screen aren't the real order yet, and disabling the chevron would drop keyboard focus mid-reorder. The store sequences list responses: only the newest request may assign, and one that was in flight across a local write (create, edit, delete, bulk edit, move) is discarded and re-asked, so a late response can neither snap the order back nor drop a just-created flight. A failed load is kept as `store.loadError` (still rethrown, so callers' own toasts work); the Flights view shows it with a "Try again" instead of "No flights yet", and Edit flight toasts and returns to the log rather than showing a blank form.
- **Existing data** is backfilled by `Migration\Version0003…`: within each `(user_id, flight_date)` it assigns `1..N` in `id` order (creation order is the best available proxy for intended sequence); any day is correctable afterward with the move action.

## Reference (instance-wide, no `user_id`)

- `flightjournal_airports` — `iata`, `icao`, `name`, `city`, `state`, `country_iso2`, `lat`, `lon`, `elevation` (feet, integer), `tz`, `source`, `updated_at`.
- `flightjournal_aircraft_types` — **one row per aircraft model, not per designator**: `icao_code` (indexed, *not* unique — it groups models), `manufacturer` + `model` (the unique natural key), `iata_code`, `engine_type`, `engine_count`, `wtc`, `description`, `canonical`, `source`, `updated_at`. See `.claude/rules/aircraft.md` for why the grain is the model.
- `flightjournal_airlines` — `iata`, `icao`, `name`, `country_iso2`, `active`.

Shared across all users on the instance. Read-mostly. Populated lazily (autocomplete miss → upstream fetch → upsert) and optionally via scheduled bulk refresh.

## Enrichment cache: `flightjournal_enrichments`

Keyed on `(flight_id, provider, kind)` with a JSON `payload` blob and `fetched_at`. Examples of `kind`: `weather_origin`, `weather_destination`, `aircraft_details`, `route_distance`. Always treated as cache.

## PHPUnit

Unit coverage lives under `tests/unit/Service/` (`FlightServiceTest`, `ImportServiceTest`, `ExportServiceTest`, `GreatCircleTest`, `AircraftTypeImportServiceTest`, `AircraftReconciliationServiceTest`). Wired up via `tests/phpunit.xml` and runnable through `composer test:unit` / `make test`. `tests/bootstrap.php` registers a PSR-4 prefix for `nextcloud/ocp` because that package ships stubs without its own autoloader — revisit if the OCP package starts autoloading itself or if tests start needing a real Nextcloud server bootstrap.

`tests/unit/Controller/FlightApiControllerTest` covers create/update. Worth keeping: the controller declares its inputs as an **explicit typed parameter list** fed to `compact()`, so a field added to the entity, the service and the client but not to that list is silently dropped and the save still reports success. That is precisely how `aircraftManufacturer`/`aircraftModel` went missing after the type-ahead landed. The tests assert the *whole* payload reaches the service rather than spot-checking fields, so the next such omission fails immediately.
Still missing: integration-style tests for `Db/FlightMapper` and migrations (need a real DB; currently out of scope for unit tests).
