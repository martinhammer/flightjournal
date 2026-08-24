<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

use OCA\FlightJournal\Db\AircraftType;
use OCA\FlightJournal\Db\AircraftTypeMapper;

/**
 * Imports aircraft reference data from the DOC 8643 CSV export, taken verbatim
 * as downloaded (ColtJD45/icao-aircraft-designator-list). Expected header:
 *
 *   manufacturer,model,type_designator,description,engine_type,engine_count,wtc
 *
 * Column order is not assumed — the header row is mapped by name — but the
 * manufacturer, model and type_designator columns must all be present.
 *
 * The import's one editorial decision is which model a bare designator resolves
 * to, recorded as `canonical`. See rankKey() for the rule and its limits.
 */
class AircraftTypeImportService {
	private const SOURCE = 'csv-upload';

	private const REQUIRED_COLUMNS = ['manufacturer', 'model', 'type_designator'];

	/**
	 * Model-name markers for corporate/military derivatives — the BBJ/ACJ private
	 * conversions and military variants that share an airliner's designator. They
	 * are demoted so a bare designator resolves to the airliner a journal user
	 * actually flew: without this B789 resolves to "787-9 BBJ" rather than
	 * "787-9 Dreamliner", and AT76 to the maritime-patrol "ATR P-72" rather than
	 * "ATR-72-600". Only 83 of 7,388 source rows match.
	 */
	private const DERIVATIVE_MARKERS = '/\b(BBJ|ACJ|Prestige|Lineage|VIP|Elite|Challenger|CC-|UV-|P-72)/i';

	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(
		private AircraftTypeMapper $mapper,
	) {
	}

	/**
	 * @return array{imported: int, updated: int, skipped: list<array{key: string, reason: string}>}
	 */
	public function importCsv(string $content): array {
		[$rows, $skipped] = $this->parse($content);

		// Group before writing: canonical is a per-designator decision, so the
		// whole file has to be in hand before any row's flag is known.
		/** @var array<string, list<array<string, string>>> $byDesignator */
		$byDesignator = [];
		foreach ($rows as $row) {
			$byDesignator[$row['type_designator']][] = $row;
		}

		$now = time();
		$imported = 0;
		$updated = 0;

		foreach ($byDesignator as $designator => $group) {
			$canonicalIndex = $this->pickCanonical($group);
			foreach ($group as $index => $row) {
				$existing = $this->mapper->findOneByModel($row['manufacturer'], $row['model']);
				$entity = $existing ?? new AircraftType();
				$entity->setIcaoCode($designator);
				$entity->setManufacturer($row['manufacturer']);
				$entity->setModel($row['model']);
				$key = AircraftModelKey::normalize($row['model']);
				$entity->setModelNormalized($key === '' ? null : $key);
				$entity->setDescription($this->nullable($row['description'] ?? null));
				$entity->setEngineType($this->nullable($row['engine_type'] ?? null));
				$entity->setEngineCount($this->intOrNull($row['engine_count'] ?? null));
				$entity->setWtc($this->nullable($row['wtc'] ?? null));
				$entity->setCanonical($index === $canonicalIndex);
				$entity->setSource(self::SOURCE);
				$entity->setUpdatedAt($now);

				if ($existing === null) {
					$this->mapper->insert($entity);
					$imported++;
				} else {
					$this->mapper->update($entity);
					$updated++;
				}
			}
		}

		return ['imported' => $imported, 'updated' => $updated, 'skipped' => $skipped];
	}

	/**
	 * Parse the CSV into normalised rows, collecting unusable ones as skips.
	 *
	 * @return array{0: list<array<string, string>>, 1: list<array{key: string, reason: string}>}
	 */
	private function parse(string $content): array {
		$handle = fopen('php://memory', 'r+');
		if ($handle === false) {
			throw new ValidationException('Unable to read the uploaded file');
		}
		fwrite($handle, $content);
		rewind($handle);

		$header = fgetcsv($handle);
		if (!is_array($header)) {
			fclose($handle);
			throw new ValidationException('File is empty or not valid CSV');
		}
		/** @var array<string, int> $columns */
		$columns = [];
		foreach ($header as $index => $name) {
			$columns[strtolower(trim((string)$name))] = $index;
		}
		foreach (self::REQUIRED_COLUMNS as $required) {
			if (!isset($columns[$required])) {
				fclose($handle);
				throw new ValidationException("Missing required column: $required");
			}
		}

		$rows = [];
		$skipped = [];
		$line = 1;
		while (($record = fgetcsv($handle)) !== false) {
			$line++;
			if (!is_array($record) || $record === [null]) {
				// Blank line — not worth reporting.
				continue;
			}

			$manufacturer = $this->cell($record, $columns, 'manufacturer');
			$model = $this->cell($record, $columns, 'model');
			$designator = $this->cell($record, $columns, 'type_designator');

			if ($manufacturer === null || $model === null) {
				// Both halves of the natural key are required — the unique index
				// on (manufacturer, model) is what identifies a row.
				$skipped[] = ['key' => "line $line", 'reason' => 'Missing manufacturer or model'];
				continue;
			}
			if ($designator === null) {
				$skipped[] = ['key' => "$manufacturer $model", 'reason' => 'Missing type_designator'];
				continue;
			}

			$rows[] = [
				'manufacturer' => $manufacturer,
				'model' => $model,
				'type_designator' => strtoupper($designator),
				'description' => $this->cell($record, $columns, 'description') ?? '',
				'engine_type' => $this->cell($record, $columns, 'engine_type') ?? '',
				'engine_count' => $this->cell($record, $columns, 'engine_count') ?? '',
				'wtc' => $this->cell($record, $columns, 'wtc') ?? '',
			];
		}
		fclose($handle);

		return [$rows, $skipped];
	}

	/**
	 * Index of the row a bare designator should resolve to.
	 *
	 * @param list<array<string, string>> $group
	 */
	private function pickCanonical(array $group): int {
		// Prefer non-derivative rows, but never eliminate every candidate: a
		// designator whose models are *all* derivatives still needs a default.
		$candidates = array_filter(
			$group,
			fn (array $row): bool => preg_match(self::DERIVATIVE_MARKERS, $row['model']) !== 1,
		);
		if ($candidates === []) {
			$candidates = $group;
		}

		// array_filter preserves keys, so $index indexes back into $group.
		$bestIndex = 0;
		$bestKey = null;
		foreach ($candidates as $index => $row) {
			$key = $this->rankKey($row);
			if ($bestKey === null || $key < $bestKey) {
				$bestKey = $key;
				$bestIndex = $index;
			}
		}
		return $bestIndex;
	}

	/**
	 * Sort key deciding the canonical model within a designator: shortest model
	 * name wins, with (manufacturer, model) as a deterministic final tiebreak.
	 *
	 * The tiebreak is not cosmetic — shortest-model alone ties in 685 of the
	 * 1,377 multi-row designators (480 of those across different manufacturers),
	 * so without it the pick would depend on file order and could silently flip
	 * between imports.
	 *
	 * This rule is deliberately simple and is known to be imperfect: CRJ9 lands
	 * on "CL-600 Regional Jet CRJ-705" rather than CRJ-900, and E190 on the bare
	 * "190". No automatic rule gets every airliner right, which is why the model
	 * is overridable per flight rather than being baked in here.
	 *
	 * @param array<string, string> $row
	 * @return list<string|int>
	 */
	private function rankKey(array $row): array {
		return [mb_strlen($row['model']), $row['manufacturer'], $row['model']];
	}

	/**
	 * @param list<string|null> $record
	 * @param array<string, int> $columns
	 */
	private function cell(array $record, array $columns, string $name): ?string {
		$index = $columns[$name] ?? null;
		if ($index === null) {
			return null;
		}
		$value = $record[$index] ?? null;
		if ($value === null) {
			return null;
		}
		$trimmed = trim($value);
		return $trimmed === '' ? null : $trimmed;
	}

	private function nullable(?string $value): ?string {
		if ($value === null) {
			return null;
		}
		$trimmed = trim($value);
		return $trimmed === '' ? null : $trimmed;
	}

	private function intOrNull(?string $value): ?int {
		$trimmed = $this->nullable($value);
		return $trimmed !== null && is_numeric($trimmed) ? (int)$trimmed : null;
	}
}
