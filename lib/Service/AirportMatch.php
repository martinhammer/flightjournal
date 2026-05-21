<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

/**
 * Outcome of a successful airport reconciliation: the canonical code and the
 * reference airport name. Either field may be null if the reference row lacks
 * it, but a match is never returned unless at least one is meaningful.
 */
final class AirportMatch {
	public function __construct(
		public readonly ?string $code,
		public readonly ?string $name,
	) {
	}
}
