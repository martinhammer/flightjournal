<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

use OCA\FlightJournal\Db\Flight;
use OCA\FlightJournal\Db\FlightMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;

class FlightService {
	private const ALLOWED_CABIN_CLASSES = ['economy', 'premium_economy', 'business', 'first', 'other'];

	/**
	 * Fields a bulk update may set. The rest — date, seat, notes — describe one
	 * leg, so setting them to the same value across many makes no sense.
	 */
	private const BULK_KEYS = [
		'cabinClass', 'airlineCode', 'flightNumber', 'registration',
		'originLabel', 'destinationLabel',
		'aircraftTypeRaw', 'aircraftTypeCode', 'aircraftManufacturer', 'aircraftModel',
	];

	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(
		private FlightMapper $mapper,
		private ITimeFactory $time,
		private AirportReconciliationService $reconciler,
		private AircraftReconciliationService $aircraftReconciler,
	) {
	}

	/**
	 * @return Flight[]
	 */
	public function findAll(string $userId): array {
		return $this->mapper->findAllForUser($userId);
	}

	public function find(int $id, string $userId): Flight {
		try {
			return $this->mapper->findForUser($id, $userId);
		} catch (DoesNotExistException) {
			throw new NotFoundException("Flight $id not found");
		}
	}

	public function create(string $userId, array $data): Flight {
		$this->validate($data);
		$flight = new Flight();
		$flight->setUserId($userId);
		$this->applyData($flight, $data);
		// Append to the end of its day; relative order is all that matters.
		$flight->setDaySeq($this->mapper->maxDaySeqForDate($userId, $flight->getFlightDate()) + 1);
		$now = $this->time->getTime();
		$flight->setCreatedAt($now);
		$flight->setUpdatedAt($now);
		return $this->mapper->insert($flight);
	}

	/**
	 * Create a flight from a backup row, preserving its explicit within-day
	 * order, distance and timestamps when present, and otherwise falling back to
	 * the same derivation as create(). Airport reconciliation still runs for any
	 * endpoint without an explicit code (so a hand-written or partial backup is
	 * reconciled), but a non-null backup distance is honoured verbatim — a backup
	 * restores faithfully even on an instance with no airport reference data.
	 *
	 * @psalm-suppress PossiblyUnusedReturnValue
	 */
	public function restore(string $userId, array $data): Flight {
		$this->validate($data);
		$flight = new Flight();
		$flight->setUserId($userId);
		$this->applyData($flight, $data);

		$daySeq = $this->int($data, 'daySeq');
		$flight->setDaySeq(
			$daySeq !== null && $daySeq > 0
				? $daySeq
				: $this->mapper->maxDaySeqForDate($userId, $flight->getFlightDate()) + 1,
		);

		// A recorded distance wins; a null/absent one leaves applyData's
		// reconciled (or null) value in place.
		$distance = $this->int($data, 'distanceKm');
		if ($distance !== null) {
			$flight->setDistanceKm($distance);
		}

		$now = $this->time->getTime();
		$createdAt = $this->int($data, 'createdAt');
		$updatedAt = $this->int($data, 'updatedAt');
		$flight->setCreatedAt($createdAt !== null && $createdAt > 0 ? $createdAt : $now);
		$flight->setUpdatedAt($updatedAt !== null && $updatedAt > 0 ? $updatedAt : $now);

		return $this->mapper->insert($flight);
	}

	public function update(int $id, string $userId, array $data): Flight {
		$flight = $this->find($id, $userId);
		$this->validate($data);
		$oldDate = $flight->getFlightDate();
		$oldDistance = $flight->getDistanceKm();

		// Resolve endpoints against the existing flight *before* overwriting it.
		// An origin/destination whose label is unchanged is preserved verbatim
		// rather than re-reconciled: re-resolving an unchanged label can wipe a
		// valid code when the stored label is not itself resolvable — e.g. an
		// imported city name like "Dublin" that matches no airport by name and is
		// ambiguous by city. Without this, editing an unrelated field (the seat,
		// say) would silently clear the route's code and distance.
		[$oLabel, $oCode, $oLat, $oLon, $oKept] = $this->resolveEndpointForUpdate(
			$data, 'originLabel', 'originCode', $flight->getOriginLabel(), $flight->getOriginCode());
		[$dLabel, $dCode, $dLat, $dLon, $dKept] = $this->resolveEndpointForUpdate(
			$data, 'destinationLabel', 'destinationCode', $flight->getDestinationLabel(), $flight->getDestinationCode());
		// Same preserve-unless-edited rule for the aircraft type; resolved against
		// the existing flight before anything is overwritten.
		$aircraft = $this->resolveAircraftForUpdate($data, $flight);

		$this->applyScalars($flight, $data);
		$this->applyAircraft($flight, $aircraft);
		$flight->setOriginLabel($oLabel);
		$flight->setOriginCode($oCode);
		$flight->setDestinationLabel($dLabel);
		$flight->setDestinationCode($dCode);
		// Both sides preserved → keep the stored distance verbatim (so an instance
		// with no reference data doesn't drop it on an unrelated edit). Otherwise
		// recompute from whatever coordinates the resolution produced.
		$flight->setDistanceKm($oKept && $dKept ? $oldDistance : $this->distanceKm($oLat, $oLon, $dLat, $dLon));

		if ($flight->getFlightDate() !== $oldDate) {
			// Re-dated onto a different day: append to the end of the new day. The
			// old day keeps its gap (harmless — only relative order matters).
			$flight->setDaySeq($this->mapper->maxDaySeqForDate($userId, $flight->getFlightDate()) + 1);
		}
		$flight->setUpdatedAt($this->time->getTime());
		return $this->mapper->update($flight);
	}

	/**
	 * Apply one set of changes to many flights, all-or-nothing.
	 *
	 * Patch semantics: a key present in $changes is set (null clears it), an
	 * absent key is left alone. Every id is looked up before anything is written,
	 * so an id that isn't the user's fails the batch with nothing changed, and the
	 * writes share one transaction.
	 *
	 * Deliberately not a loop over update(), which replaces the whole row from its
	 * input. Feeding it each stored row with the changes merged in fails twice
	 * over: stored codes would arrive as explicit client codes, whose branch drops
	 * the coordinates and so wipes distance_km (and pins a stale aircraft type over
	 * an edited raw text); and with the codes nulled instead, an endpoint stored as
	 * a code with no label (a restored backup) no longer passes validation. Only
	 * the fields being changed are touched here, through the same resolvers.
	 *
	 * @param array<array-key, mixed> $ids
	 * @param array<array-key, mixed> $changes
	 * @return list<Flight>
	 */
	public function bulkUpdate(string $userId, array $ids, array $changes): array {
		$ids = $this->bulkIds($ids);
		$this->validateBulkChanges($changes);
		$flights = array_map(fn (int $id): Flight => $this->find($id, $userId), $ids);

		return $this->mapper->transactional(function () use ($flights, $changes): array {
			$now = $this->time->getTime();
			$updated = [];
			foreach ($flights as $flight) {
				$this->applyBulkChanges($flight, $changes);
				$flight->setUpdatedAt($now);
				$updated[] = $this->mapper->update($flight);
			}
			return $updated;
		});
	}

	/**
	 * @param array<array-key, mixed> $ids
	 * @return list<int>
	 */
	private function bulkIds(array $ids): array {
		if ($ids === []) {
			throw new ValidationException('No flights selected');
		}
		foreach ($ids as $id) {
			if (!is_int($id)) {
				throw new ValidationException('ids must be a list of flight ids');
			}
		}
		/** @var list<int> */
		return array_values(array_unique($ids));
	}

	/**
	 * @param array<array-key, mixed> $changes
	 */
	private function validateBulkChanges(array $changes): void {
		if ($changes === []) {
			throw new ValidationException('No changes given');
		}
		/** @var mixed $value */
		foreach ($changes as $key => $value) {
			if (!in_array($key, self::BULK_KEYS, true)) {
				throw new ValidationException("$key cannot be bulk-edited");
			}
			if ($value !== null && !is_string($value)) {
				throw new ValidationException("$key must be a string or null");
			}
		}
		// Required on every flight, so a bulk change may replace them but not clear them.
		if (array_key_exists('originLabel', $changes) && $this->str($changes, 'originLabel') === null) {
			throw new ValidationException('Origin is required');
		}
		if (array_key_exists('destinationLabel', $changes) && $this->str($changes, 'destinationLabel') === null) {
			throw new ValidationException('Destination is required');
		}
		$cabin = $this->str($changes, 'cabinClass');
		if ($cabin !== null && !in_array($cabin, self::ALLOWED_CABIN_CLASSES, true)) {
			throw new ValidationException('Invalid cabinClass');
		}
		$hasReferenceModel = $this->str($changes, 'aircraftManufacturer') !== null || $this->str($changes, 'aircraftModel') !== null;
		if ($hasReferenceModel && $this->str($changes, 'aircraftTypeCode') === null) {
			throw new ValidationException('aircraftManufacturer and aircraftModel require aircraftTypeCode');
		}
	}

	/**
	 * Write the changed fields onto one flight. Untouched fields — including the
	 * reconciled columns of an untouched endpoint or aircraft — are never read
	 * back through a resolver, so they cannot drift.
	 *
	 * @param array<array-key, mixed> $changes
	 */
	private function applyBulkChanges(Flight $flight, array $changes): void {
		if (array_key_exists('cabinClass', $changes)) {
			$flight->setCabinClass($this->str($changes, 'cabinClass'));
		}
		if (array_key_exists('airlineCode', $changes)) {
			$flight->setAirlineCode($this->upper($this->str($changes, 'airlineCode')));
		}
		if (array_key_exists('flightNumber', $changes)) {
			$flight->setFlightNumber($this->str($changes, 'flightNumber'));
		}
		if (array_key_exists('registration', $changes)) {
			$flight->setRegistration($this->str($changes, 'registration'));
		}

		$originChanged = array_key_exists('originLabel', $changes);
		$destinationChanged = array_key_exists('destinationLabel', $changes);
		if ($originChanged || $destinationChanged) {
			// The untouched side is passed its own stored label, which takes
			// resolveEndpointForUpdate's preserve path: code and label kept, and
			// coordinates looked up from the stored code for the new distance.
			[$oLabel, $oCode, $oLat, $oLon, $oKept] = $this->resolveEndpointForUpdate(
				['originLabel' => $originChanged ? $changes['originLabel'] : $flight->getOriginLabel()],
				'originLabel', 'originCode', $flight->getOriginLabel(), $flight->getOriginCode());
			[$dLabel, $dCode, $dLat, $dLon, $dKept] = $this->resolveEndpointForUpdate(
				['destinationLabel' => $destinationChanged ? $changes['destinationLabel'] : $flight->getDestinationLabel()],
				'destinationLabel', 'destinationCode', $flight->getDestinationLabel(), $flight->getDestinationCode());
			$flight->setOriginLabel($oLabel);
			$flight->setOriginCode($oCode);
			$flight->setDestinationLabel($dLabel);
			$flight->setDestinationCode($dCode);
			if (!($oKept && $dKept)) {
				$flight->setDistanceKm($this->distanceKm($oLat, $oLon, $dLat, $dLon));
			}
		}

		if ($this->str($changes, 'aircraftTypeCode') !== null) {
			// A pick from the reference data: the triple is honoured verbatim, and
			// each leg keeps its own typed text unless the change sets one too.
			$this->applyAircraft($flight, $this->resolveAircraft(
				$changes + ['aircraftTypeRaw' => $flight->getAircraftTypeRaw()]));
		} elseif (array_key_exists('aircraftTypeRaw', $changes)) {
			$raw = $this->str($changes, 'aircraftTypeRaw');
			// Clearing is an explicit instruction here, so it bypasses update()'s
			// preserve rule: a leg with a code but no raw text (a restored backup)
			// would otherwise count as "unchanged" and keep its type.
			$this->applyAircraft($flight, $raw === null
				? [null, null, null, null]
				: $this->resolveAircraftForUpdate(['aircraftTypeRaw' => $raw], $flight));
		}
	}

	/**
	 * Move a flight one position within its day by swapping day_seq with the
	 * adjacent same-day leg. A no-op (returns the flight unchanged) when it is
	 * already first/last in its day.
	 *
	 * Direction is expressed in day order, not screen position: "earlier" moves
	 * toward leg 1 (lower day_seq), "later" away from it. The view translates its
	 * up/down chevron into one of these based on the active sort direction.
	 *
	 * @param string $direction Either "earlier" or "later".
	 */
	public function move(int $id, string $userId, string $direction): Flight {
		if ($direction !== 'earlier' && $direction !== 'later') {
			throw new ValidationException('direction must be "earlier" or "later"');
		}
		$flight = $this->find($id, $userId);
		$neighbor = $this->mapper->findSwapNeighbor($flight, $direction);
		if ($neighbor === null) {
			return $flight;
		}

		$flightSeq = $flight->getDaySeq();
		$flight->setDaySeq($neighbor->getDaySeq());
		$neighbor->setDaySeq($flightSeq);
		$now = $this->time->getTime();
		$flight->setUpdatedAt($now);
		$neighbor->setUpdatedAt($now);
		$this->mapper->update($neighbor);
		$this->mapper->update($flight);
		return $flight;
	}

	public function delete(int $id, string $userId): void {
		$flight = $this->find($id, $userId);
		$this->mapper->delete($flight);
	}

	public function deleteAll(string $userId): int {
		return $this->mapper->deleteAllForUser($userId);
	}

	/**
	 * Re-run airport reconciliation across the user's flights.
	 *
	 * When $onlyMissing is true, a side (origin/destination) is skipped if it
	 * already has a code; otherwise every side is refreshed.
	 *
	 * Each processed side follows the hybrid rule (see refreshEndpoint): a side
	 * that already has a code is refreshed *from that canonical code* (a failed
	 * lookup leaves it untouched, never clearing a valid code), while a code-less
	 * side is resolved from its free-text label as on create. This makes a bulk
	 * recheck safe for imported/backup data whose label is not itself resolvable,
	 * and non-destructive on an instance with no reference data loaded.
	 *
	 * @return array{flights: int, updated: int, matched: int, unmatched: int}
	 */
	public function reconcileAll(string $userId, bool $onlyMissing): array {
		$flights = $this->mapper->findAllForUser($userId);
		$updated = 0;
		$matched = 0;
		$unmatched = 0;

		foreach ($flights as $flight) {
			$changed = false;
			// Distance is only recomputed when both sides resolved to coordinates
			// in this pass; a skipped or preserved-without-match side leaves it.
			$originMatch = null;
			$destMatch = null;
			$originProcessed = false;
			$destProcessed = false;

			if ($flight->getOriginLabel() !== null
				&& !($onlyMissing && $flight->getOriginCode() !== null)) {
				$originProcessed = true;
				[$label, $code, $originMatch, $sideChanged] = $this->refreshEndpoint(
					$flight->getOriginLabel(), $flight->getOriginCode(),
				);
				$originMatch === null ? $unmatched++ : $matched++;
				if ($sideChanged) {
					$flight->setOriginLabel($label);
					$flight->setOriginCode($code);
					$changed = true;
				}
			}

			if ($flight->getDestinationLabel() !== null
				&& !($onlyMissing && $flight->getDestinationCode() !== null)) {
				$destProcessed = true;
				[$label, $code, $destMatch, $sideChanged] = $this->refreshEndpoint(
					$flight->getDestinationLabel(), $flight->getDestinationCode(),
				);
				$destMatch === null ? $unmatched++ : $matched++;
				if ($sideChanged) {
					$flight->setDestinationLabel($label);
					$flight->setDestinationCode($code);
					$changed = true;
				}
			}

			if ($originProcessed && $destProcessed && $originMatch !== null && $destMatch !== null) {
				$distance = $this->distanceKm(
					$originMatch->lat, $originMatch->lon,
					$destMatch->lat, $destMatch->lon,
				);
				if ($distance !== $flight->getDistanceKm()) {
					$flight->setDistanceKm($distance);
					$changed = true;
				}
			}

			if ($changed) {
				$flight->setUpdatedAt($this->time->getTime());
				$this->mapper->update($flight);
				$updated++;
			}
		}

		return [
			'flights' => count($flights),
			'updated' => $updated,
			'matched' => $matched,
			'unmatched' => $unmatched,
		];
	}

	/**
	 * Re-run aircraft type reconciliation across the user's flights.
	 *
	 * Follows the same hybrid as reconcileAll: a flight that already has a
	 * designator is refreshed *from that designator* (a failed lookup leaves it
	 * untouched, never clearing a valid code), while one without a code is
	 * resolved from its raw text as on create. So 'all' scope canonicalises and
	 * fills in reference models but never destroys a code because the raw text
	 * stopped resolving, and is a no-op on an instance with no reference data.
	 *
	 * A stored model that differs from its designator's canonical model can only
	 * have come from an explicit choice (a restored backup today; the Edit-flight
	 * dropdown later), so it is treated as pinned and preserved while the code
	 * itself is still canonicalised.
	 *
	 * @return array{flights: int, updated: int, matched: int, unmatched: int}
	 */
	public function reconcileAircraftAll(string $userId, bool $onlyMissing): array {
		$flights = $this->mapper->findAllForUser($userId);
		$updated = 0;
		$matched = 0;
		$unmatched = 0;

		foreach ($flights as $flight) {
			$code = $flight->getAircraftTypeCode();
			$raw = $flight->getAircraftTypeRaw();
			if ($code === null && $raw === null) {
				// Nothing recorded for this leg — not a miss, just absent.
				continue;
			}
			// "Missing" means missing *reference data*, not merely missing a code.
			// A row can carry a designator with no manufacturer/model — a JSON
			// restore honours a stored code verbatim without resolving it — and
			// keying the skip on the code alone would strand those forever: the
			// Aircraft column falls back to the raw text, and every default run
			// declines to fix it while reporting success. All three must be present
			// before a row counts as done, because the column renders manufacturer
			// and model together.
			if ($onlyMissing
				&& $code !== null
				&& $flight->getAircraftManufacturer() !== null
				&& $flight->getAircraftModel() !== null) {
				continue;
			}

			[$newCode, $newManufacturer, $newModel, $hit] = $this->refreshAircraft(
				$raw, $code, $flight->getAircraftManufacturer(), $flight->getAircraftModel(),
			);
			$hit ? $matched++ : $unmatched++;

			if ($newCode !== $code
				|| $newManufacturer !== $flight->getAircraftManufacturer()
				|| $newModel !== $flight->getAircraftModel()) {
				$flight->setAircraftTypeCode($newCode);
				$flight->setAircraftManufacturer($newManufacturer);
				$flight->setAircraftModel($newModel);
				$flight->setUpdatedAt($this->time->getTime());
				$this->mapper->update($flight);
				$updated++;
			}
		}

		return [
			'flights' => count($flights),
			'updated' => $updated,
			'matched' => $matched,
			'unmatched' => $unmatched,
		];
	}

	/**
	 * Refresh one flight's aircraft columns during a bulk recheck.
	 *
	 * @return array{0: ?string, 1: ?string, 2: ?string, 3: bool} [code, manufacturer, model, hit]
	 */
	private function refreshAircraft(?string $raw, ?string $code, ?string $manufacturer, ?string $model): array {
		if ($code !== null) {
			$match = $this->aircraftReconciler->resolveDesignator($code);
			if ($match === null) {
				// Unknown designator, or no reference data loaded — the code is
				// authoritative once set, so leave it exactly as it is.
				return [$code, $manufacturer, $model, false];
			}
			$pinned = $model !== null && $match->model !== null && $model !== $match->model;
			return $pinned
				? [$match->code, $manufacturer, $model, true]
				: [$match->code, $match->manufacturer, $match->model, true];
		}

		$match = $this->aircraftReconciler->resolve($raw);
		if ($match === null) {
			return [null, null, null, false];
		}
		return [$match->code, $match->manufacturer, $match->model, true];
	}

	private function validate(array $data): void {
		$date = $this->str($data, 'flightDate');
		if ($date === null) {
			throw new ValidationException('flightDate is required');
		}
		if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
			throw new ValidationException('flightDate must be YYYY-MM-DD');
		}

		$hasOrigin = $this->str($data, 'originCode') !== null || $this->str($data, 'originLabel') !== null;
		$hasDestination = $this->str($data, 'destinationCode') !== null || $this->str($data, 'destinationLabel') !== null;
		if (!$hasOrigin) {
			throw new ValidationException('Origin is required');
		}
		if (!$hasDestination) {
			throw new ValidationException('Destination is required');
		}

		$cabin = $this->str($data, 'cabinClass');
		if ($cabin !== null && !in_array($cabin, self::ALLOWED_CABIN_CLASSES, true)) {
			throw new ValidationException('Invalid cabinClass');
		}
	}

	private function applyData(Flight $flight, array $data): void {
		$this->applyScalars($flight, $data);

		[$originLabel, $originCode, $originLat, $originLon] = $this->resolveEndpoint($data, 'originLabel', 'originCode');
		[$destinationLabel, $destinationCode, $destLat, $destLon] = $this->resolveEndpoint($data, 'destinationLabel', 'destinationCode');
		$flight->setOriginLabel($originLabel);
		$flight->setOriginCode($originCode);
		$flight->setDestinationLabel($destinationLabel);
		$flight->setDestinationCode($destinationCode);
		$flight->setDistanceKm($this->distanceKm($originLat, $originLon, $destLat, $destLon));

		$this->applyAircraft($flight, $this->resolveAircraft($data));
	}

	/**
	 * Write the four aircraft columns from a resolved [raw, code, manufacturer,
	 * model] tuple.
	 *
	 * @param array{0: ?string, 1: ?string, 2: ?string, 3: ?string} $resolved
	 */
	private function applyAircraft(Flight $flight, array $resolved): void {
		[$raw, $code, $manufacturer, $model] = $resolved;
		$flight->setAircraftTypeRaw($raw);
		$flight->setAircraftTypeCode($code);
		$flight->setAircraftManufacturer($manufacturer);
		$flight->setAircraftModel($model);
	}

	/**
	 * Apply every non-reconciled field (date plus the free-text/metadata columns).
	 * Split out so update() can refresh these without re-running the airport or
	 * aircraft resolution that applyData() does.
	 */
	private function applyScalars(Flight $flight, array $data): void {
		$flight->setFlightDate((string)$this->str($data, 'flightDate'));
		$flight->setAirlineCode($this->upper($this->str($data, 'airlineCode')));
		$flight->setFlightNumber($this->str($data, 'flightNumber'));
		$flight->setRegistration($this->str($data, 'registration'));
		$flight->setCabinClass($this->str($data, 'cabinClass'));
		$flight->setSeat($this->str($data, 'seat'));
		$flight->setNotes($this->str($data, 'notes'));
	}

	/**
	 * Determine the stored label and code for one endpoint (origin/destination).
	 *
	 * An explicit client-supplied code is honoured as-is (the SPA never sends
	 * one). Otherwise the label is reconciled against the airport reference
	 * table; on a match the code is filled and the label is replaced with the
	 * reference airport name (the user's verbatim text is intentionally not
	 * preserved). A reference row without a name leaves the label untouched.
	 *
	 * @param array<array-key, mixed> $data
	 * @return array{0: ?string, 1: ?string, 2: ?float, 3: ?float} [label, code, lat, lon]
	 */
	private function resolveEndpoint(array $data, string $labelKey, string $codeKey): array {
		$label = $this->str($data, $labelKey);

		$explicitCode = $this->upper($this->str($data, $codeKey));
		if ($explicitCode !== null) {
			return [$label, $explicitCode, null, null];
		}

		$match = $this->reconciler->resolve($label);
		if ($match === null) {
			return [$label, null, null, null];
		}
		return [$match->name ?? $label, $match->code, $match->lat, $match->lon];
	}

	/**
	 * Resolve one endpoint for an update, preserving a previously reconciled
	 * endpoint whose label the user left unchanged.
	 *
	 * An explicit client-supplied code still wins (as in create). Otherwise, when
	 * the submitted label equals the stored label and the endpoint already has a
	 * code, the stored label+code are kept and coordinates are refreshed by
	 * resolving that code (exact and reliable) for the distance calc. Only a
	 * changed (or never-coded) label is reconciled afresh, exactly as create does
	 * — so re-reconciliation, and the code-clearing it can cause, happens only for
	 * an endpoint the user actually edited.
	 *
	 * `kept` (the 5th element) is true when the endpoint was preserved unchanged.
	 *
	 * @param array<array-key, mixed> $data
	 * @return array{0: ?string, 1: ?string, 2: ?float, 3: ?float, 4: bool} [label, code, lat, lon, kept]
	 */
	private function resolveEndpointForUpdate(array $data, string $labelKey, string $codeKey, ?string $oldLabel, ?string $oldCode): array {
		$explicitCode = $this->upper($this->str($data, $codeKey));
		if ($explicitCode !== null) {
			return [$this->str($data, $labelKey), $explicitCode, null, null, false];
		}

		$label = $this->str($data, $labelKey);
		if ($oldCode !== null && $label === $oldLabel) {
			$match = $this->reconciler->resolve($oldCode);
			return [$oldLabel, $oldCode, $match?->lat, $match?->lon, true];
		}

		[$newLabel, $code, $lat, $lon] = $this->resolveEndpoint($data, $labelKey, $codeKey);
		return [$newLabel, $code, $lat, $lon, false];
	}

	/**
	 * Determine the stored aircraft columns from submitted data.
	 *
	 * The verbatim `aircraftTypeRaw` is *always* preserved — unlike an airport
	 * label, which is overwritten with the reference name on a match. The
	 * resolved model lands in its own columns alongside it.
	 *
	 * An explicit client-supplied code is honoured as-is together with any
	 * manufacturer/model sent with it, which is how a JSON backup restores its
	 * recorded type verbatim on an instance with no reference data. The SPA never
	 * sends a code, so in practice codes always come from the resolver.
	 *
	 * @param array<array-key, mixed> $data
	 * @return array{0: ?string, 1: ?string, 2: ?string, 3: ?string} [raw, code, manufacturer, model]
	 */
	private function resolveAircraft(array $data): array {
		$raw = $this->str($data, 'aircraftTypeRaw');

		$explicitCode = $this->upper($this->str($data, 'aircraftTypeCode'));
		if ($explicitCode !== null) {
			return [
				$raw,
				$explicitCode,
				$this->str($data, 'aircraftManufacturer'),
				$this->str($data, 'aircraftModel'),
			];
		}

		$match = $this->aircraftReconciler->resolve($raw);
		if ($match === null) {
			return [$raw, null, null, null];
		}
		return [$raw, $match->code, $match->manufacturer, $match->model];
	}

	/**
	 * Resolve the aircraft columns for an update, preserving a previously
	 * resolved type whose raw text the user left unchanged.
	 *
	 * Same reasoning as resolveEndpointForUpdate: re-resolving on every save would
	 * let an unrelated edit (the seat, say) clear a valid type when the stored raw
	 * text is not itself resolvable. Only text the user actually changed is
	 * reconciled afresh — and an unresolvable new value still clears the stale
	 * code, as intended.
	 *
	 * @param array<array-key, mixed> $data
	 * @return array{0: ?string, 1: ?string, 2: ?string, 3: ?string} [raw, code, manufacturer, model]
	 */
	private function resolveAircraftForUpdate(array $data, Flight $flight): array {
		if ($this->upper($this->str($data, 'aircraftTypeCode')) !== null) {
			return $this->resolveAircraft($data);
		}

		$raw = $this->str($data, 'aircraftTypeRaw');
		if ($flight->getAircraftTypeCode() !== null && $raw === $flight->getAircraftTypeRaw()) {
			return [
				$raw,
				$flight->getAircraftTypeCode(),
				$flight->getAircraftManufacturer(),
				$flight->getAircraftModel(),
			];
		}

		return $this->resolveAircraft($data);
	}

	/**
	 * Whole-km great-circle distance, or null unless both endpoints have coords.
	 */
	private function distanceKm(?float $lat1, ?float $lon1, ?float $lat2, ?float $lon2): ?int {
		if ($lat1 === null || $lon1 === null || $lat2 === null || $lon2 === null) {
			return null;
		}
		return GreatCircle::distanceKm($lat1, $lon1, $lat2, $lon2);
	}

	/**
	 * Refresh one endpoint during a bulk recheck, following the hybrid rule:
	 *
	 *   - Code already present → refresh *from the canonical code* (code → name /
	 *     coords). A failed lookup (e.g. no reference data, or an unknown code)
	 *     leaves the endpoint untouched rather than clearing a valid code — the
	 *     code is authoritative once set. A hit may canonicalise the code (ICAO →
	 *     IATA) and rewrite the label to the reference name.
	 *   - No code yet → resolve the free-text label (label → code), exactly as on
	 *     create; a null result leaves the label and the (still null) code.
	 *
	 * `match` carries the reference coordinates for the distance recompute.
	 *
	 * @return array{0: ?string, 1: ?string, 2: ?AirportMatch, 3: bool} [label, code, match, changed]
	 */
	private function refreshEndpoint(?string $label, ?string $code): array {
		if ($code !== null) {
			$match = $this->reconciler->resolve($code);
			if ($match === null) {
				return [$label, $code, null, false];
			}
			$newLabel = $match->name ?? $label;
			$newCode = $match->code ?? $code;
			$changed = $newLabel !== $label || $newCode !== $code;
			return [$newLabel, $newCode, $match, $changed];
		}

		$match = $this->reconciler->resolve($label);
		if ($match === null) {
			return [$label, null, null, false];
		}
		return [$match->name ?? $label, $match->code, $match, true];
	}

	private function str(array $data, string $key): ?string {
		$value = $data[$key] ?? null;
		if (!is_string($value)) {
			return null;
		}
		$trimmed = trim($value);
		return $trimmed === '' ? null : $trimmed;
	}

	private function int(array $data, string $key): ?int {
		/** @var mixed $value */
		$value = $data[$key] ?? null;
		return is_int($value) ? $value : null;
	}

	private function upper(?string $value): ?string {
		return $value === null ? null : strtoupper($value);
	}

}
