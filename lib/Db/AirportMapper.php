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

	public function deleteAll(): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName());
		return $qb->executeStatement();
	}

	public function count(): int {
		return $this->countSearch(null);
	}

	/**
	 * @return Airport[]
	 */
	public function search(?string $q, int $limit, int $offset): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->orderBy('icao', 'ASC')
			->addOrderBy('iata', 'ASC')
			->setMaxResults($limit)
			->setFirstResult($offset);
		$this->applySearch($qb, $q);
		return $this->findEntities($qb);
	}

	public function countSearch(?string $q): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'cnt'))
			->from($this->getTableName());
		$this->applySearch($qb, $q);
		$result = $qb->executeQuery();
		/** @var array<string, mixed>|false $row */
		$row = $result->fetch();
		$result->closeCursor();
		if ($row === false) {
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
}
