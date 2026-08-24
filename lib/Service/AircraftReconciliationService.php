<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

use OCA\FlightJournal\Db\AircraftType;
use OCA\FlightJournal\Db\AircraftTypeMapper;

/**
 * Resolves free-text aircraft input against the aircraft type reference table.
 *
 * Matching is strictly exact and tiered, mirroring AirportReconciliationService;
 * nothing fuzzy is ever auto-applied:
 *   1. ICAO type designator (case-insensitive) — "B738" → the designator's
 *      canonical model.
 *   2. Model name (case-insensitive, must be unambiguous) — "737-800" → that
 *      row. 1,034 model strings are shared by more than one manufacturer, so an
 *      ambiguous name resolves to nothing rather than guessing.
 *   3. Only when $ignorePunctuation is set: the same model comparison with
 *      separators removed, so "A320neo" reaches DOC 8643's "A-320neo". Still
 *      exact and still required to be unambiguous — see Service\AircraftModelKey.
 *
 * Tier 3 is opt-in because it widens what counts as a match; it is offered as a
 * switch on the bulk recheck rather than applied silently on every save.
 *
 * There is deliberately no IATA tier: the `iata_code` column exists but the
 * IATA overlay is not imported yet, so such a tier would always miss.
 *
 * No match yields null — the flight stays valid either way, and the user's
 * verbatim `aircraft_type_raw` is never discarded.
 */
class AircraftReconciliationService {
	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(
		private AircraftTypeMapper $types,
	) {
	}

	/**
	 * Resolve free text to a designator + reference model, or null when there is
	 * no confident, unambiguous match.
	 *
	 * @param bool $ignorePunctuation Enable the separator-tolerant model tier.
	 */
	public function resolve(?string $input, bool $ignorePunctuation = false): ?AircraftMatch {
		if ($input === null) {
			return null;
		}
		$term = trim($input);
		if ($term === '') {
			return null;
		}

		$row = $this->types->findCanonicalByDesignator($term)
			?? $this->types->findOneByModelName($term);

		if ($row === null && $ignorePunctuation) {
			$row = $this->types->findOneByNormalizedModel(AircraftModelKey::normalize($term));
		}

		return $row === null ? null : $this->toMatch($row);
	}

	/**
	 * Resolve a designator to its canonical model, ignoring the model-name tier.
	 *
	 * Used by the bulk recheck, where a flight that already has a designator must
	 * be refreshed *from that designator* rather than re-guessed from its raw
	 * text — the same rule that keeps airport rechecks non-destructive.
	 */
	public function resolveDesignator(?string $designator): ?AircraftMatch {
		if ($designator === null) {
			return null;
		}
		$term = trim($designator);
		if ($term === '') {
			return null;
		}
		$row = $this->types->findCanonicalByDesignator($term);
		return $row === null ? null : $this->toMatch($row);
	}

	private function toMatch(AircraftType $row): AircraftMatch {
		return new AircraftMatch(
			strtoupper(trim($row->getIcaoCode())),
			$this->clean($row->getManufacturer()),
			$this->clean($row->getModel()),
		);
	}

	private function clean(?string $value): ?string {
		if ($value === null) {
			return null;
		}
		$trimmed = trim($value);
		return $trimmed === '' ? null : $trimmed;
	}
}
