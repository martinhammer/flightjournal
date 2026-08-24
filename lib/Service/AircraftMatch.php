<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

/**
 * Outcome of a successful aircraft reconciliation: the canonical ICAO type
 * designator plus the specific reference model it resolved to.
 *
 * Manufacturer and model travel together because `model` alone does not
 * identify a reference row — 629 designators contain two models with the same
 * name under different manufacturers.
 */
final class AircraftMatch {
	public function __construct(
		public readonly string $code,
		public readonly ?string $manufacturer,
		public readonly ?string $model,
	) {
	}
}
