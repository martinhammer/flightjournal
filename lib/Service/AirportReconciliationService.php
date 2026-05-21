<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

use OCA\FlightJournal\Db\Airport;
use OCA\FlightJournal\Db\AirportMapper;

/**
 * Resolves a free-text airport label against the airport reference table.
 *
 * Matching is strictly exact and tiered; nothing fuzzy is ever auto-applied:
 *   1. IATA or ICAO code (case-insensitive)
 *   2. Airport name (case-insensitive, must be unambiguous)
 *   3. City (case-insensitive, must resolve to exactly one airport)
 *
 * On a hit the canonical code is the IATA code when present, otherwise ICAO.
 * No match (or an ambiguous one) yields null — the flight stays valid either way.
 */
class AirportReconciliationService {
	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(
		private AirportMapper $airports,
	) {
	}

	/**
	 * Resolve a label to a reference airport (canonical code + name), or null
	 * when there is no confident, unambiguous match.
	 */
	public function resolve(?string $label): ?AirportMatch {
		if ($label === null) {
			return null;
		}
		$term = trim($label);
		if ($term === '') {
			return null;
		}

		$match = $this->airports->findOneByCode($term)
			?? $this->airports->findOneByName($term);
		if ($match === null) {
			$byCity = $this->airports->findByCity($term);
			$match = count($byCity) === 1 ? $byCity[0] : null;
		}
		if ($match === null) {
			return null;
		}

		$name = $match->getName();
		if ($name !== null && trim($name) === '') {
			$name = null;
		}
		return new AirportMatch($this->canonicalCode($match), $name);
	}

	private function canonicalCode(Airport $airport): ?string {
		$iata = $airport->getIata();
		if ($iata !== null && trim($iata) !== '') {
			return strtoupper(trim($iata));
		}
		$icao = $airport->getIcao();
		if ($icao !== null && trim($icao) !== '') {
			return strtoupper(trim($icao));
		}
		return null;
	}
}
