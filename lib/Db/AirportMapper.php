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
		$param = $qb->createNamedParameter(self::foldings($code), IQueryBuilder::PARAM_STR_ARRAY);
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->orX(
				$qb->expr()->in($qb->func()->lower('iata'), $param),
				$qb->expr()->in($qb->func()->lower('icao'), $param),
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
			->where($qb->expr()->in(
				$qb->func()->lower('name'),
				$qb->createNamedParameter(self::foldings($name), IQueryBuilder::PARAM_STR_ARRAY),
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
		$lower = self::foldAll($codes);
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
			->where($qb->expr()->in(
				$qb->func()->lower('city'),
				$qb->createNamedParameter(self::foldings($city), IQueryBuilder::PARAM_STR_ARRAY),
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
		// Escaped, so a typed % or _ is searched for rather than acting as a
		// wildcard (the term is bound either way; this is about what it matches).
		$likes = [];
		foreach (self::foldings($term) as $folded) {
			$param = $qb->createNamedParameter('%' . $this->db->escapeLikeParameter($folded) . '%');
			foreach (['icao', 'iata', 'name', 'city'] as $column) {
				$likes[] = $qb->expr()->like($qb->func()->lower($column), $param);
			}
		}
		$qb->andWhere($qb->expr()->orX(...$likes));
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
		$lower = self::foldAll($codes);
		$param = $qb->createNamedParameter($lower, IQueryBuilder::PARAM_STR_ARRAY);
		$qb->andWhere($qb->expr()->orX(
			$qb->expr()->in($qb->func()->lower('iata'), $param),
			$qb->expr()->in($qb->func()->lower('icao'), $param),
		));
	}

	/**
	 * The lower-cased forms to compare against SQL `LOWER(column)`.
	 *
	 * Both, because databases disagree on what `LOWER` folds: MySQL and
	 * PostgreSQL (in a UTF-8 locale) fold "Ç" to "ç", which only `mb_strtolower`
	 * matches, while SQLite without ICU folds ASCII only and leaves "Ç" alone,
	 * which only the ASCII-only `strtolower` matches. Comparing against both
	 * lets "ÇUKUROVA INTERNATIONAL AIRPORT" find the airport on either kind.
	 * For an all-ASCII value the two are the same string, so it costs nothing.
	 *
	 * @return list<string>
	 */
	private static function foldings(string $value): array {
		return array_values(array_unique([mb_strtolower($value), strtolower($value)]));
	}

	/**
	 * {@see foldings()} over a list, de-duplicated.
	 *
	 * @param list<string> $values
	 * @return list<string>
	 */
	private static function foldAll(array $values): array {
		$all = [];
		foreach ($values as $value) {
			foreach (self::foldings($value) as $folded) {
				$all[$folded] = true;
			}
		}
		return array_map('strval', array_keys($all));
	}
}
