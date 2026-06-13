<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<Airport>
 */
class AirportMapper extends QBMapper {
	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'flightjournal_airports', Airport::class);
	}

	/**
	 * @throws DoesNotExistException
	 */
	public function findByIcao(string $icao): Airport {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('icao', $qb->createNamedParameter($icao)));
		return $this->findEntity($qb);
	}

	/**
	 * Find an airport whose IATA or ICAO code equals the given value (case-insensitive).
	 */
	public function findOneByCode(string $code): ?Airport {
		$qb = $this->db->getQueryBuilder();
		$param = $qb->createNamedParameter(strtolower($code));
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->orX(
				$qb->expr()->eq($qb->func()->lower('iata'), $param),
				$qb->expr()->eq($qb->func()->lower('icao'), $param),
			))
			->setMaxResults(1);
		$rows = $this->findEntities($qb);
		return $rows[0] ?? null;
	}

	/**
	 * Find an airport whose name equals the given value (case-insensitive).
	 */
	public function findOneByName(string $name): ?Airport {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq(
				$qb->func()->lower('name'),
				$qb->createNamedParameter(strtolower($name)),
			))
			->setMaxResults(2);
		$rows = $this->findEntities($qb);
		return count($rows) === 1 ? $rows[0] : null;
	}

	/**
	 * Find every airport whose IATA or ICAO code is in the given list
	 * (case-insensitive).
	 *
	 * @param list<string> $codes
	 * @return Airport[]
	 */
	public function findByCodes(array $codes): array {
		$lower = array_values(array_unique(array_map('strtolower', $codes)));
		if ($lower === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$param = $qb->createNamedParameter($lower, IQueryBuilder::PARAM_STR_ARRAY);
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->orX(
				$qb->expr()->in($qb->func()->lower('iata'), $param),
				$qb->expr()->in($qb->func()->lower('icao'), $param),
			));
		return $this->findEntities($qb);
	}

	/**
	 * Find airports whose city equals the given value (case-insensitive).
	 *
	 * @return Airport[]
	 */
	public function findByCity(string $city): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq(
				$qb->func()->lower('city'),
				$qb->createNamedParameter(strtolower($city)),
			))
			->setMaxResults(2);
		return $this->findEntities($qb);
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
	 * When $codes is non-null, restrict to airports whose IATA or ICAO code is
	 * in the list (case-insensitive); an empty list matches nothing.
	 *
	 * @param list<string>|null $codes
	 * @return Airport[]
	 */
	public function search(?string $q, int $limit, int $offset, ?array $codes = null): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->orderBy('icao', 'ASC')
			->addOrderBy('iata', 'ASC')
			->setMaxResults($limit)
			->setFirstResult($offset);
		$this->applySearch($qb, $q);
		$this->applyCodes($qb, $codes);
		return $this->findEntities($qb);
	}

	/**
	 * @param list<string>|null $codes See {@see search()}.
	 */
	public function countSearch(?string $q, ?array $codes = null): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'cnt'))
			->from($this->getTableName());
		$this->applySearch($qb, $q);
		$this->applyCodes($qb, $codes);
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
		$like = '%' . strtolower($term) . '%';
		$param = $qb->createNamedParameter($like);
		$qb->andWhere($qb->expr()->orX(
			$qb->expr()->like($qb->func()->lower('icao'), $param),
			$qb->expr()->like($qb->func()->lower('iata'), $param),
			$qb->expr()->like($qb->func()->lower('name'), $param),
			$qb->expr()->like($qb->func()->lower('city'), $param),
		));
	}

	/**
	 * @param list<string>|null $codes
	 */
	private function applyCodes(IQueryBuilder $qb, ?array $codes): void {
		if ($codes === null) {
			return;
		}
		if ($codes === []) {
			// Restricted to an empty set — match nothing.
			$qb->andWhere($qb->expr()->eq(
				$qb->createNamedParameter(0, IQueryBuilder::PARAM_INT),
				$qb->createNamedParameter(1, IQueryBuilder::PARAM_INT),
			));
			return;
		}
		$lower = array_values(array_unique(array_map('strtolower', $codes)));
		$param = $qb->createNamedParameter($lower, IQueryBuilder::PARAM_STR_ARRAY);
		$qb->andWhere($qb->expr()->orX(
			$qb->expr()->in($qb->func()->lower('iata'), $param),
			$qb->expr()->in($qb->func()->lower('icao'), $param),
		));
	}
}
