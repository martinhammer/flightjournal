<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

class ImportService {
	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(
		private FlightService $flights,
	) {
	}

	/**
	 * Import flights from a Markdown table with columns:
	 *   Date | Flight | Route | Type | Tail
	 *
	 * Date format: YYYY/MM/DD (slashes) or YYYY-MM-DD (dashes).
	 * Route format: ORIGIN-DESTINATION (split on the first hyphen).
	 * Flight format: alphanumeric airline prefix followed by digits (e.g. SK4745, W61383).
	 *
	 * @return array{
	 *     imported: int,
	 *     skipped: list<array{line: int, reason: string, raw: string}>,
	 * }
	 */
	public function importMarkdownTable(string $userId, string $markdown): array {
		$rows = $this->parseMarkdownTable($markdown);
		$imported = 0;
		$skipped = [];

		foreach ($rows as $row) {
			try {
				$data = $this->rowToFlightInput($row['cells']);
				$this->flights->create($userId, $data);
				$imported++;
			} catch (ValidationException $e) {
				$skipped[] = [
					'line' => $row['line'],
					'reason' => $e->getMessage(),
					'raw' => $row['raw'],
				];
			} catch (\InvalidArgumentException $e) {
				$skipped[] = [
					'line' => $row['line'],
					'reason' => $e->getMessage(),
					'raw' => $row['raw'],
				];
			}
		}

		return ['imported' => $imported, 'skipped' => $skipped];
	}

	/**
	 * @return list<array{line: int, raw: string, cells: list<string>}>
	 */
	private function parseMarkdownTable(string $markdown): array {
		$rows = [];
		$lines = preg_split('/\r\n|\n|\r/', trim($markdown)) ?: [];
		$firstContentRowSkipped = false;

		foreach ($lines as $idx => $rawLine) {
			$line = trim($rawLine);
			if ($line === '' || str_starts_with($line, '<!--')) {
				continue;
			}
			if (!str_starts_with($line, '|')) {
				continue;
			}
			$cells = $this->splitMarkdownRow($line);
			if (count($cells) === 0) {
				continue;
			}
			// Separator row: cells consist only of -, :, and whitespace
			$isSeparator = true;
			foreach ($cells as $cell) {
				if (!preg_match('/^[\s\-:]+$/', $cell)) {
					$isSeparator = false;
					break;
				}
			}
			if ($isSeparator) {
				continue;
			}
			// Skip a header row only if the first non-separator content row does
			// not look like data. Heuristic: data rows start with a date.
			if (!$firstContentRowSkipped) {
				$firstContentRowSkipped = true;
				if (!$this->looksLikeDate($cells[0] ?? '')) {
					continue;
				}
			}
			$rows[] = [
				'line' => $idx + 1,
				'raw' => $line,
				'cells' => $cells,
			];
		}

		return $rows;
	}

	private function looksLikeDate(string $value): bool {
		return (bool)preg_match('/^\s*\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s*$/', $value);
	}

	/**
	 * @return list<string>
	 */
	private function splitMarkdownRow(string $line): array {
		$line = trim($line);
		if (str_starts_with($line, '|')) {
			$line = substr($line, 1);
		}
		if (str_ends_with($line, '|')) {
			$line = substr($line, 0, -1);
		}
		$parts = explode('|', $line);
		return array_map(fn ($cell) => trim($cell), $parts);
	}

	/**
	 * @param list<string> $cells
	 * @return array<string, string|null>
	 */
	private function rowToFlightInput(array $cells): array {
		if (count($cells) < 5) {
			throw new \InvalidArgumentException('Row does not have 5 columns');
		}
		[$date, $flight, $route, $type, $tail] = $cells;

		$flightDate = $this->normalizeDate($date);
		[$airline, $number] = $this->splitFlightNumber($flight);
		[$origin, $destination] = $this->splitRoute($route);

		return [
			'flightDate' => $flightDate,
			'originLabel' => $origin,
			'destinationLabel' => $destination,
			'airlineCode' => $airline,
			'flightNumber' => $number,
			'aircraftTypeRaw' => $this->blankToNull($type),
			'registration' => $this->blankToNull($tail),
		];
	}

	private function normalizeDate(string $value): string {
		$value = trim($value);
		if (preg_match('/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/', $value, $m)) {
			return sprintf('%04d-%02d-%02d', (int)$m[1], (int)$m[2], (int)$m[3]);
		}
		throw new \InvalidArgumentException("Unrecognized date '$value' (expected YYYY/MM/DD or YYYY-MM-DD)");
	}

	/**
	 * @return array{0: ?string, 1: ?string}
	 */
	private function splitFlightNumber(string $value): array {
		$value = trim($value);
		if ($value === '' || strcasecmp($value, 'N/A') === 0) {
			return [null, null];
		}
		if (preg_match('/^([A-Z0-9]{2,3})\s*(\d+)$/i', $value, $m)) {
			return [strtoupper($m[1]), $m[2]];
		}
		// Fallback: keep the whole token as flight number, no airline split
		return [null, $value];
	}

	/**
	 * @return array{0: ?string, 1: ?string}
	 */
	private function splitRoute(string $value): array {
		$value = trim($value);
		if ($value === '') {
			return [null, null];
		}
		$parts = explode('-', $value, 2);
		if (count($parts) !== 2) {
			throw new \InvalidArgumentException("Unrecognized route '$value' (expected ORIGIN-DESTINATION)");
		}
		return [trim($parts[0]) ?: null, trim($parts[1]) ?: null];
	}

	private function blankToNull(string $value): ?string {
		$trimmed = trim($value);
		if ($trimmed === '' || strcasecmp($trimmed, 'N/A') === 0) {
			return null;
		}
		return $trimmed;
	}
}
