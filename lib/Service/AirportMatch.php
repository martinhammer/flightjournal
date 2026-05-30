<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

/**
 * Outcome of a successful airport reconciliation: the canonical code, the
 * reference airport name, and the reference coordinates. Any field may be null
 * if the reference row lacks it, but a match is never returned unless at least
 * one of code/name is meaningful. Coordinates feed great-circle distance.
 */
final class AirportMatch {
	public function __construct(
		public readonly ?string $code,
		public readonly ?string $name,
		public readonly ?float $lat = null,
		public readonly ?float $lon = null,
	) {
	}
}
