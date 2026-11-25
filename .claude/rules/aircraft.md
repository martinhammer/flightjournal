---
paths:
  - "lib/Service/AircraftReconciliationService.php"
  - "lib/Service/AircraftTypeImportService.php"
  - "lib/Service/AircraftModelKey.php"
  - "lib/Service/FlightService.php"
  - "lib/Db/AircraftTypeMapper.php"
  - "lib/Controller/AircraftTypeApiController.php"
  - "src/components/AircraftTypeField.vue"
  - "src/components/AircraftResolution.vue"
  - "src/types.ts"
---

# Aircraft reconciliation

`Service/AircraftReconciliationService::resolve(?string $input): ?AircraftMatch` resolves free-text aircraft input against `flightjournal_aircraft_types`. Exact and tiered, never fuzzy, mirroring the airport resolver:

1. ICAO type designator (case-insensitive) → that designator's **canonical** model.
2. Model name (case-insensitive; ignored if not unique — 1,034 model strings are shared across manufacturers).
3. The same model comparison against `model_normalized`, a stored key of just letters and digits (`Service/AircraftModelKey::normalize`, shared by the importer that writes it and the resolver that derives it from user input, so they can't drift). Lets "A320neo" reach DOC 8643's "A-320neo". Still exact and still uniqueness-guarded — normalising collapses only 5,988 → 5,982 distinct model keys, so it adds almost no ambiguity. It deliberately does **not** bridge a missing word: "787-9" still won't reach "787-9 Dreamliner", nor "A350-900" reach "A-350-900 XWB"; those need the designator (B789 / A359). Worth **101 → 175 legs** on the 200-leg demo fixture.

**Tier 3 is always on, and is strictly additive** — consulted only after both strict tiers return null, so it can never change a result that already resolved, only fill in a blank (pinned by two tests). Its failure mode is a *missing* match, never a wrong one: normalising two models onto one key makes that key ambiguous, and an ambiguous key resolves to nothing. It shipped briefly as an opt-in "Ignore punctuation" switch on the bulk recheck; that was removed because an option which can only help made the default the worse one, and because a recheck-only flag meant saves matched differently from rechecks.

No IATA tier: the column exists but the IATA overlay is deliberately not imported yet, so such a tier would always miss.

**Why the reference table is at model grain.** In DOC 8643 a designator maps to many models — 1,377 of 2,688 designators have more than one (B738 is both the 737-800 and the 737-800 BBJ2). Collapsing at import would discard exactly the rows a disambiguation UI needs, so every row is kept and one per designator is flagged `canonical`. `(manufacturer, model)` is the unique key because `model` alone fails to identify a row within its designator for 629 designators.

**Canonical ranking** (`AircraftTypeImportService::pickCanonical`) — a short list of named overrides, then two filters, then a sort:

0. **Named overrides (`PREFERRED`).** Five designators the rule gets wrong are named outright: B77L → BOEING 777-200LR (not "777-F"), DH8A → DE HAVILLAND CANADA DHC-8-100 Dash 8 (not the military "E-9 Dash 8"), DC10 → MCDONNELL DOUGLAS DC-10 (not BOEING "MD-10"), C130 → LOCKHEED C-130H Hercules (not "EC-130 Aya"), C30J → LOCKHEED MARTIN C-130J Super Hercules (not the "AC-130J Ghostrider" gunship). Applied only when the named row is in the file, otherwise the rule decides. **No digit rule could fix them** — every DC10 candidate's digits are `10` and every C130/C30J candidate's `130`, DH8A's lone `8` is in every Dash 8, and a closest-digits tiebreak would pick B77L's "777-F" *more* surely — so naming them is the fix, not a stopgap. They came from the code review, not the OpenFlights scoring below, which doesn't cover them. Against the full DOC 8643 file the table changes exactly these 5 of 2,688 picks. Mirrored by `_PREFERRED` in the fixture generator. E170/E190/E195 → the bare "170"/"190"/"195" are deliberately *not* overridden: those are the names passengers know.

1. **Digit containment.** A designator encodes its model number (B737 → 737-700, A332 → A3**3**0-**2**00, B738 → 737-**8**00), so keep only models whose digits contain the designator's digits as an **ordered subsequence**. Subsequence, not substring: "332" is not a substring of "330200" but is a subsequence — exactly the A332 case. Vacuous for letter-only designators (GLID, BALL).
2. **Derivative demotion.** Drop `BBJ|ACJ|Prestige|Lineage|VIP|Elite|Challenger|CC-|UV-|P-72` (83 of 7,388 rows).
3. **Shortest model name**, then 4. **alphabetical by `(manufacturer, model)`**.

Both filters share one invariant: **they never eliminate every candidate** — a filter that would empty the set is skipped for that designator (digits find nothing for 15 designators, all-derivative for 4). Filter order is load-bearing for exactly one designator: `CC11` gives "CC-11 Sport Cub" digits-first but "CCK-1865 Carbon Cub" demote-first, because `CC-` (added for the CC-138 Twin Otter) falsely flags Cub Crafters — digits-first neutralises it.

The alphabetical tiebreak is not cosmetic: shortest-model alone ties in 685 of the 1,377 ambiguous designators, so without it the pick would follow file order and could silently flip between imports. Verified: 0 of 2,688 picks change when the input is shuffled.

Scored against the OpenFlights name list (the ~230 types passengers actually fly) as an independent oracle, the digit filter lifts correct picks from **102/157 to 132/157, with 30 improved and 0 regressed**; it changes 243 of 1,377 multi-model designators overall. Still imperfect — E190 lands on the bare "190" because both it and "ERJ-190-100" carry the digits — which is why the model is meant to be overridable per flight rather than baked in. **Changing this rule requires a re-import to take effect**, and is safe for user data: `reconcileAircraftAll` preserves a stored model that differs from the canonical one. The flip side, **accepted**: a recheck cannot tell a deliberately chosen sibling from a leg stamped with the *previous* default, so after a ranking change legs already stamped with the old pick ("777-F", "E-9 Dash 8", "MD-10") keep it until someone re-picks them — one leg with the type-ahead, many with bulk edit (filter the log by that aircraft first). Tracking the model's provenance in a column was considered and declined. **A re-import is authoritative per designator:** inside one transaction, `AircraftTypeMapper::clearCanonical` first clears the flag on every stored row of each designator the file lists, then the file's own pick is set. Upsert never deletes, so without that a default the new file dropped (or a stale row from an older extract) kept its flag beside the new pick, and `findCanonicalByDesignator` — which takes the first canonical row by manufacturer/model — resolved to whichever sorted first; nothing in the schema enforces one canonical row per `icao_code`. Designators the file does not list are left untouched, so a partial file speaks only for its own designators. A table imported before this fix can still carry duplicate flags; re-importing the full file repairs it.

**Divergence from airports on preservation:** an airport label is *overwritten* with the reference name on a match; `aircraft_type_raw` is **always preserved**. The resolved model lands in its own `aircraft_manufacturer` / `aircraft_model` columns alongside it.

**Denormalized, and by natural key.** Reconciliation copies the resolved manufacturer/model onto the flight (as airport reconciliation copies the airport name into `origin_label`), keeping the list endpoint join-free. Stored as the natural key rather than a reference id, because surrogate ids don't survive a re-import and are meaningless in a JSON backup restored on another instance.

Reconciliation runs in the same four places as airports, all through the one resolver:

1. **New flight** — `FlightService::create` resolves `aircraftTypeRaw`.
2. **Edit flight** — `resolveAircraftForUpdate` re-resolves **only when the raw text actually changed**. Same reasoning as `resolveEndpointForUpdate`: otherwise an unrelated edit (the seat) could clear a valid type whose stored text isn't itself resolvable. An edited value that fails to resolve still clears the stale code, as intended.
3. **Bulk import** — via `FlightService::create` / `restore`. A backup's explicit code + manufacturer + model are honoured verbatim, so a restore is faithful on an instance with no reference data.
4. **Recheck-all** — `FlightService::reconcileAircraftAll` + `POST /api/v1/flights/reconcile-aircraft` (scope `missing` | `all`), from Personal settings → Maintenance. **`missing` means missing reference data, not merely missing a code**: a row is skipped only when its designator, manufacturer *and* model are all present. Keying on the code alone stranded rows that carry a designator with no manufacturer/model — a JSON restore honours a stored code verbatim without resolving it, so those rows fall back to the raw text in the Aircraft column while every default run skips them and still reports success. All three matter because the column renders manufacturer and model together via `aircraftName()`. Follows the same hybrid: a flight with a designator is refreshed *from that designator* (`resolveDesignator`, which deliberately does **not** fall through to the model-name tier), and a failed lookup leaves it untouched rather than clearing a valid code. A stored model differing from its designator's canonical model is treated as explicitly chosen and preserved while the code is still canonicalised.

**A per-flight override already exists**: the type-ahead below can pick any reference row, a designator's non-default models included, in Edit flight, Add flight and Bulk edit. What is **not built** is a narrower *designator-scoped* dropdown listing just one designator's models. It needs a public `findByDesignator` on the mapper (the private `byDesignator(…, canonicalOnly: false)` already returns the right rows, canonical first), an endpoint to serve the option list, and `aircraftManufacturer`/`aircraftModel` added back into `FlightInput`. `reconcileAircraftAll` already preserves an explicitly chosen model, so the recheck won't undo the choice once it exists.

**Editor input** (`components/AircraftTypeField.vue`, in both `EditFlightLog` and `AddFlightDialog`): a text field that *gains* a type-ahead over the reference data — never a select that requires it, so the free-text path keeps working on an instance with no aircraft data ("never block on enrichment"). Two ways in:

- **Free text** → the form sends null codes and the server reconciles on save, exactly as before.
- **A pick** → sets an `AircraftSelection` (`{code, manufacturer, model}`), which `withAircraftSelection()` folds into the payload; `FlightService::resolveAircraft` then honours it verbatim via the same explicit-code branch a JSON restore uses. No new backend was needed for this.

**A pick never overwrites `aircraft_type_raw`.** This is where aircraft diverges from airports: `resolveEndpoint` replaces `origin_label` with the reference airport name because there are only two columns and the name has nowhere else to go. Aircraft has four, so the reference values already have dedicated homes — overwriting `raw` would duplicate one string across two columns and destroy the only record of what the user typed. That record is what makes a JSON round-trip, a reference re-import with a different canonical ranking, and a future bulk "fix every leg that says X" all possible.

**`aircraftSelection` is null on load, by design.** Pre-filling it from the stored code would resurrect the stale-code bug (an explicit client code makes the backend skip re-reconciling an edited entry). A stored pick still survives an unrelated edit, because `resolveAircraftForUpdate` preserves the whole stored triple when the raw text is unchanged. Editing the text clears an active pick — it described a different string.

The component is standalone rather than inline so `BulkEditDialog` can mount it and apply the same `AircraftSelection` across many flights (see `.claude/rules/flight-log.md`).

`AircraftTypeMapper::applySearch` also matches `model_normalized`, so the type-ahead finds what reconciliation finds ("A320neo" → "A-320neo"); without it the suggestion list would be strictly less capable than the field it sits on.

**Editor feedback** (`components/AircraftResolution.vue`, rendered by `AircraftTypeField` whenever no pick is active): a read-only line under the Aircraft type field reporting what the *current* text resolves to — matched designator + model, "no reference match", or "no reference data on this instance". It re-resolves as you type (debounced 300 ms, with a token guard so a slow early reply can't overwrite a newer one) rather than reporting the flight's stored result, because the workflow it serves is fixing an entry that didn't resolve and a stale badge would keep saying "no match" while you type the fix. It calls `GET /api/v1/aircraft-types/resolve` — which exists so the preview runs the **server's** tiers; any client-side approximation would drift from them and promise a match that never happens. The endpoint returns `referenceLoaded` alongside a null match so an empty reference table reads differently from a genuine miss. It deliberately ignores the flight's stored manufacturer/model, which can differ from a fresh resolve when a model was explicitly chosen — reconciling that belongs with the override UI that creates it.

**Display is reference-first** everywhere: `aircraftDisplay()` in `src/types.ts` returns `aircraftName(manufacturer, model) ?? aircraftTypeRaw ?? aircraftTypeCode`, i.e. "BOEING 737-800" rather than "B738" or the typed "738". Shared by the log table cell, its sort key, `filters.ts` matching and the `FilterPicker` option list so they can never disagree. Note this is the opposite fallback order from the route column (code-first) — deliberate, so the resolved (or user-chosen) type is what the log shows.

`aircraftName()` is factored out because the **flights filter matches on this exact string**, so anything that links *into* a filtered flights view must spell a reference row identically: the Aircraft types row menu (`ViewAircraftTypes.showFlights`) and the type-ahead's option/pick labels all go through it. A second copy of that join would drift and silently produce links matching nothing.

**The markdown export deliberately does *not* mirror the column** — it stays model-only (`getAircraftModel() ?? raw ?? code`). Markdown is re-importable, and its aircraft string lands in `aircraft_type_raw` to be reconciled; "737-800" resolves on tier 2 but "BOEING 737-800" matches no tier, so mirroring the UI would break the round-trip.
