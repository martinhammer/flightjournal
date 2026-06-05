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

	public function update(int $id, string $userId, array $data): Flight {
		$flight = $this->find($id, $userId);
		$this->validate($data);
		$oldDate = $flight->getFlightDate();
		$this->applyData($flight, $data);
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
	 * already has a code; otherwise every side with a label is re-resolved.
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
			// Distance is only recomputed when both sides are resolved in this
			// pass; a side skipped under $onlyMissing leaves the distance as-is.
			$originMatch = null;
			$destMatch = null;
			$originResolved = false;
			$destResolved = false;

			if ($flight->getOriginLabel() !== null
				&& !($onlyMissing && $flight->getOriginCode() !== null)) {
				$originResolved = true;
				$originMatch = $this->reconciler->resolve($flight->getOriginLabel());
				$originMatch === null ? $unmatched++ : $matched++;
				[$label, $code, $sideChanged] = $this->reapplyMatch(
					$originMatch, $flight->getOriginLabel(), $flight->getOriginCode(),
				);
				if ($sideChanged) {
					$flight->setOriginLabel($label);
					$flight->setOriginCode($code);
					$changed = true;
				}
			}

			if ($flight->getDestinationLabel() !== null
				&& !($onlyMissing && $flight->getDestinationCode() !== null)) {
				$destResolved = true;
				$destMatch = $this->reconciler->resolve($flight->getDestinationLabel());
				$destMatch === null ? $unmatched++ : $matched++;
				[$label, $code, $sideChanged] = $this->reapplyMatch(
					$destMatch, $flight->getDestinationLabel(), $flight->getDestinationCode(),
				);
				if ($sideChanged) {
					$flight->setDestinationLabel($label);
					$flight->setDestinationCode($code);
					$changed = true;
				}
			}

			if ($originResolved && $destResolved) {
				$distance = $this->distanceKm(
					$originMatch?->lat, $originMatch?->lon,
					$destMatch?->lat, $destMatch?->lon,
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
		$flight->setFlightDate((string)$this->str($data, 'flightDate'));

		[$originLabel, $originCode, $originLat, $originLon] = $this->resolveEndpoint($data, 'originLabel', 'originCode');
		[$destinationLabel, $destinationCode, $destLat, $destLon] = $this->resolveEndpoint($data, 'destinationLabel', 'destinationCode');
		$flight->setOriginLabel($originLabel);
		$flight->setOriginCode($originCode);
		$flight->setDestinationLabel($destinationLabel);
		$flight->setDestinationCode($destinationCode);
		$flight->setDistanceKm($this->distanceKm($originLat, $originLon, $destLat, $destLon));
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
	 * Whole-km great-circle distance, or null unless both endpoints have coords.
	 */
	private function distanceKm(?float $lat1, ?float $lon1, ?float $lat2, ?float $lon2): ?int {
		if ($lat1 === null || $lon1 === null || $lat2 === null || $lon2 === null) {
			return null;
		}
		return GreatCircle::distanceKm($lat1, $lon1, $lat2, $lon2);
	}

	/**
	 * Compute the new label/code for one endpoint when re-running reconciliation
	 * over an existing flight. No match clears a stale code but keeps the label.
	 *
	 * @return array{0: ?string, 1: ?string, 2: bool} [label, code, changed]
	 */
	private function reapplyMatch(?AirportMatch $match, ?string $label, ?string $code): array {
		if ($match === null) {
			return [$label, null, $code !== null];
		}
		$newLabel = $match->name ?? $label;
		$changed = $newLabel !== $label || $match->code !== $code;
		return [$newLabel, $match->code, $changed];
	}

	private function str(array $data, string $key): ?string {
		$value = $data[$key] ?? null;
		if (!is_string($value)) {
			return null;
		}
		$trimmed = trim($value);
		return $trimmed === '' ? null : $trimmed;
	}

	private function upper(?string $value): ?string {
		return $value === null ? null : strtoupper($value);
	}

}
