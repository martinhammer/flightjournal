---
paths:
  - "lib/Service/AirportReconciliationService.php"
  - "lib/Service/FlightService.php"
  - "lib/Service/GreatCircle.php"
  - "lib/Db/AirportMapper.php"
  - "lib/Controller/AirportApiController.php"
  - "src/components/AirportResolution.vue"
---

# Airport reconciliation

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
