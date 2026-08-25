<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Db;

use OCA\FlightJournal\Service\AircraftModelKey;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<AircraftType>
 */
class AircraftTypeMapper extends QBMapper {
	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'flightjournal_aircraft_types', AircraftType::class);
	}

	/**
	 * The default row for a designator — the one a bare "B738" resolves to.
	 *
	 * Falls back to any row for the designator when no canonical flag is set, so
	 * a reference table imported by an older/partial process still resolves.
	 */
	public function findCanonicalByDesignator(string $designator): ?AircraftType {
		$rows = $this->byDesignator($designator, canonicalOnly: true);
		if ($rows !== []) {
			return $rows[0];
		}
		$rows = $this->byDesignator($designator, canonicalOnly: false);
		return $rows[0] ?? null;
	}

	/**
	 * Exact natural-key lookup. Both halves are required because `model` alone
	 * fails to identify a row within its designator for 629 designators.
	 */
	public function findOneByModel(string $manufacturer, string $model): ?AircraftType {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq(
				$qb->func()->lower('manufacturer'),
				$qb->createNamedParameter(mb_strtolower($manufacturer)),
			))
			->andWhere($qb->expr()->eq(
				$qb->func()->lower('model'),
				$qb->createNamedParameter(mb_strtolower($model)),
			))
			->setMaxResults(1);
		$rows = $this->findEntities($qb);
		return $rows[0] ?? null;
	}

	/**
	 * Find a row by model name alone, but only when that name is unambiguous —
	 * 1,034 model strings are shared by more than one manufacturer, so an
	 * ambiguous hit must resolve to nothing rather than guess.
	 */
	public function findOneByModelName(string $model): ?AircraftType {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq(
				$qb->func()->lower('model'),
				$qb->createNamedParameter(mb_strtolower($model)),
			))
			->setMaxResults(2);
		$rows = $this->findEntities($qb);
		return count($rows) === 1 ? $rows[0] : null;
	}

	/**
	 * Find a row by the punctuation-insensitive model key, but only when that key
	 * is unambiguous — same uniqueness discipline as findOneByModelName(), which
	 * is what keeps this a separator-tolerant *exact* match rather than a guess.
	 *
	 * @param string $key Already normalised by Service\AircraftModelKey.
	 */
	public function findOneByNormalizedModel(string $key): ?AircraftType {
		if ($key === '') {
			return null;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq(
				'model_normalized',
				$qb->createNamedParameter($key),
			))
			->setMaxResults(2);
		$rows = $this->findEntities($qb);
		return count($rows) === 1 ? $rows[0] : null;
	}

	public function deleteAll(): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName());
		return $qb->executeStatement();
	}

	public function count(): int {
		return $this->countSearch(null);
	}

	/**
	 * A page of aircraft types, grouped by designator with its default model
	 * first so the variants read as belonging to it.
	 *
	 * When $designators is non-null, restrict to those ICAO type designators
	 * (case-insensitive); an empty list matches nothing.
	 *
	 * @param list<string>|null $designators
	 * @return AircraftType[]
	 */
	public function search(?string $q, int $limit, int $offset, ?array $designators = null): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->orderBy('icao_code', 'ASC')
			->addOrderBy('canonical', 'DESC')
			->addOrderBy('manufacturer', 'ASC')
			->addOrderBy('model', 'ASC')
			->setMaxResults($limit)
			->setFirstResult($offset);
		$this->applySearch($qb, $q);
		$this->applyDesignators($qb, $designators);
		return $this->findEntities($qb);
	}

	/**
	 * @param list<string>|null $designators See {@see search()}.
	 */
	public function countSearch(?string $q, ?array $designators = null): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'cnt'))
			->from($this->getTableName());
		$this->applySearch($qb, $q);
		$this->applyDesignators($qb, $designators);
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		if (!is_array($row)) {
			return 0;
		}
		return (int)($row['cnt'] ?? 0);
	}

	private function applySearch(IQueryBuilder $qb, ?string $q): void {
		if ($q === null) {
			return;
		}
		$term = trim($q);
		if ($term === '') {
			return;
		}
		$like = '%' . mb_strtolower($term) . '%';
		$param = $qb->createNamedParameter($like);
		// model_normalized is searched too, so the editor's type-ahead finds what
		// reconciliation would find: "A320neo" reaches DOC 8643's "A-320neo".
		// Without it the suggestion list would be strictly less capable than the
		// free-text field it sits on. Matched against the normalised needle, since
		// the stored key has its separators stripped.
		$qb->andWhere($qb->expr()->orX(
			$qb->expr()->like($qb->func()->lower('icao_code'), $param),
			$qb->expr()->like($qb->func()->lower('iata_code'), $param),
			$qb->expr()->like($qb->func()->lower('manufacturer'), $param),
			$qb->expr()->like($qb->func()->lower('model'), $param),
			$qb->expr()->like(
				'model_normalized',
				$qb->createNamedParameter('%' . AircraftModelKey::normalize($term) . '%'),
			),
		));
	}

	/**
	 * @param list<string>|null $designators
	 */
	private function applyDesignators(IQueryBuilder $qb, ?array $designators): void {
		if ($designators === null) {
			return;
		}
		if ($designators === []) {
			// Restricted to an empty set — match nothing.
			$qb->andWhere($qb->expr()->eq(
				$qb->createNamedParameter(0, IQueryBuilder::PARAM_INT),
				$qb->createNamedParameter(1, IQueryBuilder::PARAM_INT),
			));
			return;
		}
		$lower = array_values(array_unique(array_map('mb_strtolower', $designators)));
		$qb->andWhere($qb->expr()->in(
			$qb->func()->lower('icao_code'),
			$qb->createNamedParameter($lower, IQueryBuilder::PARAM_STR_ARRAY),
		));
	}

	/**
	 * @return AircraftType[]
	 */
	private function byDesignator(string $designator, bool $canonicalOnly): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq(
				$qb->func()->lower('icao_code'),
				$qb->createNamedParameter(mb_strtolower($designator)),
			))
			->orderBy('canonical', 'DESC')
			->addOrderBy('manufacturer', 'ASC')
			->addOrderBy('model', 'ASC');
		if ($canonicalOnly) {
			$qb->andWhere($qb->expr()->eq(
				'canonical',
				$qb->createNamedParameter(true, IQueryBuilder::PARAM_BOOL),
			));
			$qb->setMaxResults(1);
		}
		return $this->findEntities($qb);
	}
}
