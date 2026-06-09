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
			$origin = $flight->getOriginCode() ?? $flight->getOriginLabel() ?? '';
			$destination = $flight->getDestinationCode() ?? $flight->getDestinationLabel() ?? '';
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

	/**
	 * Current schema version of the JSON export envelope. Bump when the shape of
	 * an exported flight changes in a way importers need to branch on.
	 */
	public const JSON_FORMAT_VERSION = 1;

	/**
	 * Render the user's flights as a pretty-printed JSON backup.
	 *
	 * Unlike the Markdown table (a lossy, human-friendly summary), this carries
	 * every field so the export can round-trip losslessly back through import,
	 * including within-day ordering (day_seq), the derived distance, and the
	 * record timestamps. Only the database surrogate key (id) is omitted, as it
	 * is reassigned on restore.
	 */
	public function exportJson(string $userId): string {
		$flights = $this->flights->findAll($userId);

		$rows = [];
		foreach (array_reverse($flights) as $flight) {
			$rows[] = [
				'flightDate' => $flight->getFlightDate(),
				'daySeq' => $flight->getDaySeq(),
				'originCode' => $flight->getOriginCode(),
				'destinationCode' => $flight->getDestinationCode(),
				'originLabel' => $flight->getOriginLabel(),
				'destinationLabel' => $flight->getDestinationLabel(),
				'airlineCode' => $flight->getAirlineCode(),
				'flightNumber' => $flight->getFlightNumber(),
				'aircraftTypeCode' => $flight->getAircraftTypeCode(),
				'aircraftTypeRaw' => $flight->getAircraftTypeRaw(),
				'registration' => $flight->getRegistration(),
				'cabinClass' => $flight->getCabinClass(),
				'seat' => $flight->getSeat(),
				'notes' => $flight->getNotes(),
				'distanceKm' => $flight->getDistanceKm(),
				'createdAt' => $flight->getCreatedAt(),
				'updatedAt' => $flight->getUpdatedAt(),
			];
		}

		$envelope = [
			'app' => 'flightjournal',
			'version' => self::JSON_FORMAT_VERSION,
			'exportedAt' => gmdate('c'),
			'flights' => $rows,
		];

		return json_encode($envelope, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
	}
}
