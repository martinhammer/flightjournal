<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

use OCA\FlightJournal\Db\Airport;
use OCA\FlightJournal\Db\AirportMapper;
use OCP\AppFramework\Db\DoesNotExistException;

/**
 * Imports airport reference data from a JSON object keyed by ICAO code.
 *
 * Expected input shape:
 *   {
 *     "KOSH": { "icao": "KOSH", "iata": "OSH", "name": "...", "city": "...",
 *               "state": "...", "country": "US", "elevation": 808,
 *               "lat": 43.98, "lon": -88.55, "tz": "America/Chicago" },
 *     ...
 *   }
 */
class AirportImportService {
	private const SOURCE = 'json-upload';

	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(
		private AirportMapper $mapper,
	) {
	}

	/**
	 * @return array{imported: int, updated: int, skipped: list<array{key: string, reason: string}>}
	 */
	public function importJson(string $content): array {
		$decoded = json_decode($content, true);
		if (!is_array($decoded)) {
			throw new ValidationException('Payload is not a valid JSON object');
		}

		$now = time();
		$imported = 0;
		$updated = 0;
		$skipped = [];

		foreach ($decoded as $key => $row) {
			$keyStr = is_string($key) ? $key : (string)$key;
			if (!is_array($row)) {
				$skipped[] = ['key' => $keyStr, 'reason' => 'Entry is not an object'];
				continue;
			}

			$icao = $this->str($row['icao'] ?? null) ?? (is_string($key) ? strtoupper($key) : null);
			$iata = $this->str($row['iata'] ?? null);

			if ($icao === null && $iata === null) {
				$skipped[] = ['key' => $keyStr, 'reason' => 'Missing both icao and iata'];
				continue;
			}

			$existing = null;
			if ($icao !== null) {
				try {
					$existing = $this->mapper->findByIcao($icao);
				} catch (DoesNotExistException) {
					$existing = null;
				}
			}

			$entity = $existing ?? new Airport();
			$entity->setIata($iata);
			$entity->setIcao($icao);
			$entity->setName($this->str($row['name'] ?? null));
			$entity->setCity($this->str($row['city'] ?? null));
			$entity->setState($this->str($row['state'] ?? null));
			$entity->setCountryIso2($this->countryIso2($row['country'] ?? null));
			$entity->setLat($this->float($row['lat'] ?? null));
			$entity->setLon($this->float($row['lon'] ?? null));
			$entity->setElevation($this->int($row['elevation'] ?? null));
			$entity->setTz($this->str($row['tz'] ?? null));
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

		return ['imported' => $imported, 'updated' => $updated, 'skipped' => $skipped];
	}

	private function str(mixed $v): ?string {
		if ($v === null) {
			return null;
		}
		$s = trim((string)$v);
		return $s === '' ? null : $s;
	}

	private function countryIso2(mixed $v): ?string {
		$s = $this->str($v);
		if ($s === null) {
			return null;
		}
		$s = strtoupper($s);
		return strlen($s) === 2 ? $s : null;
	}

	private function float(mixed $v): ?float {
		if ($v === null || $v === '') {
			return null;
		}
		return is_numeric($v) ? (float)$v : null;
	}

	private function int(mixed $v): ?int {
		if ($v === null || $v === '') {
			return null;
		}
		return is_numeric($v) ? (int)$v : null;
	}
}
