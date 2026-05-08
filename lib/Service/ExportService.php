<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

class ExportService {
	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(
		private FlightService $flights,
	) {
	}

	/**
	 * Render the user's flights as a Markdown table matching the import format.
	 */
	public function exportMarkdownTable(string $userId): string {
		$flights = $this->flights->findAll($userId);

		$lines = [
			'| Date       | Flight | Route   | Type    | Tail   |',
			'|------------|--------|---------|---------|--------|',
		];

		foreach (array_reverse($flights) as $flight) {
			$date = str_replace('-', '/', $flight->getFlightDate());
			$flightNo = ($flight->getAirlineCode() ?? '') . ($flight->getFlightNumber() ?? '');
			$origin = $flight->getOriginLabel() ?? $flight->getOriginCode() ?? '';
			$destination = $flight->getDestinationLabel() ?? $flight->getDestinationCode() ?? '';
			$route = $origin !== '' || $destination !== '' ? "$origin-$destination" : '';
			$type = $flight->getAircraftTypeRaw() ?? $flight->getAircraftTypeCode() ?? '';
			$tail = $flight->getRegistration() ?? '';

			$lines[] = sprintf(
				'| %s | %s | %s | %s | %s |',
				$date,
				$flightNo !== '' ? $flightNo : 'N/A',
				$route,
				$type,
				$tail,
			);
		}

		return implode("\n", $lines) . "\n";
	}
}
