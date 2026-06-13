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
			// Within-day order must follow the day-level direction: newest day on
			// top → that day's last leg on top. All three keys move in lockstep;
			// when the sortable view flips to oldest-first, all three flip together.
			->orderBy('flight_date', 'DESC')
			->addOrderBy('day_seq', 'DESC')
			->addOrderBy('id', 'DESC');
		return $this->findEntities($qb);
	}

	/**
	 * Highest day_seq currently used on a given (user, date), or 0 if that day
	 * has no flights yet. Used to append a new/re-dated leg to the end of its day.
	 */
	public function maxDaySeqForDate(string $userId, string $flightDate): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->max('day_seq'))
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('flight_date', $qb->createNamedParameter($flightDate)));
		$result = $qb->executeQuery();
		/** @var string|int|false|null $max */
		$max = $result->fetchOne();
		$result->closeCursor();
		return ($max === false || $max === null) ? 0 : (int)$max;
	}

	/**
	 * The adjacent same-day leg in day order: 'earlier' → the next-lower day_seq
	 * (toward leg 1), 'later' → the next-higher day_seq. For a move/swap. Returns
	 * null when the flight is already first/last in its day. Display-independent —
	 * the view maps its up/down chevron onto these based on the active sort.
	 */
	public function findSwapNeighbor(Flight $flight, string $direction): ?Flight {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($flight->getUserId())))
			->andWhere($qb->expr()->eq('flight_date', $qb->createNamedParameter($flight->getFlightDate())))
			->setMaxResults(1);
		if ($direction === 'earlier') {
			$qb->andWhere($qb->expr()->lt('day_seq', $qb->createNamedParameter($flight->getDaySeq(), IQueryBuilder::PARAM_INT)))
				->orderBy('day_seq', 'DESC');
		} else {
			$qb->andWhere($qb->expr()->gt('day_seq', $qb->createNamedParameter($flight->getDaySeq(), IQueryBuilder::PARAM_INT)))
				->orderBy('day_seq', 'ASC');
		}
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
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
				$row = $result->fetch();
				if (!is_array($row)) {
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
