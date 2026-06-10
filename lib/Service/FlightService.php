<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

use OCA\FlightJournal\Db\Flight;
use OCA\FlightJournal\Db\FlightMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;

class FlightService {
	private const ALLOWED_CABIN_CLASSES = ['economy', 'premium_economy', 'business', 'first', 'other'];

	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(
		private FlightMapper $mapper,
		private ITimeFactory $time,
		private AirportReconciliationService $reconciler,
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

		$this->applyScalars($flight, $data);
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
	}

	/**
	 * Apply every non-endpoint field (date plus the free-text/metadata columns).
	 * Split out so update() can refresh these without re-running the airport
	 * resolution that applyData() does for origin/destination.
	 */
	private function applyScalars(Flight $flight, array $data): void {
		$flight->setFlightDate((string)$this->str($data, 'flightDate'));
		$flight->setAirlineCode($this->upper($this->str($data, 'airlineCode')));
		$flight->setFlightNumber($this->str($data, 'flightNumber'));
		$flight->setAircraftTypeCode($this->upper($this->str($data, 'aircraftTypeCode')));
		$flight->setAircraftTypeRaw($this->str($data, 'aircraftTypeRaw'));
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
