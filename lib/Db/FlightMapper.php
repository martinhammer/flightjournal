<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<Flight>
 */
class FlightMapper extends QBMapper {
	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'flightjournal_flights', Flight::class);
	}

	/**
	 * @return Flight[]
	 */
	public function findAllForUser(string $userId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->orderBy('flight_date', 'DESC')
			->addOrderBy('id', 'DESC');
		return $this->findEntities($qb);
	}

	/**
	 * Distinct origin/destination codes across all of a user's flights.
	 *
	 * @return list<string>
	 */
	public function findFlownAirportCodes(string $userId): array {
		$codes = [];
		foreach (['origin_code', 'destination_code'] as $column) {
			$qb = $this->db->getQueryBuilder();
			$qb->selectDistinct($column)
				->from($this->getTableName())
				->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
				->andWhere($qb->expr()->isNotNull($column));
			$result = $qb->executeQuery();
			while (true) {
				/** @var array<string, mixed>|false $row */
				$row = $result->fetch();
				if ($row === false) {
					break;
				}
				if (is_string($row[$column]) && $row[$column] !== '') {
					$codes[$row[$column]] = true;
				}
			}
			$result->closeCursor();
		}
		return array_keys($codes);
	}

	public function deleteAllForUser(string $userId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		return $qb->executeStatement();
	}

	/**
	 * @throws DoesNotExistException
	 */
	public function findForUser(int $id, string $userId): Flight {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		return $this->findEntity($qb);
	}
}
