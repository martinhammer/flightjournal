<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\DB\Types;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Adds a within-day ordering key to each flight. `day_seq` sequences the legs
 * a user flew on the same date (1-based, dense); only its order relative to the
 * other legs of the same (user_id, flight_date) is meaningful. Cross-day order
 * is still governed by flight_date, and id remains the final tiebreaker.
 *
 * The column is NOT NULL with a default of 0 so the DDL can add it to a
 * populated table; postSchemaChange then backfills real 1..N values. New rows
 * always get an explicit value from FlightService.
 *
 * Backfill assigns 1..N within each (user_id, flight_date) in id order —
 * creation order is the best available proxy for the intended within-day
 * sequence. Users can correct any day afterwards with the move (up/down) action.
 *
 * @psalm-suppress UnusedClass
 * @psalm-suppress UndefinedDocblockClass
 */
class Version0003Date20260605000000 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		$schema = $schemaClosure();

		$table = $schema->getTable('flightjournal_flights');
		if (!$table->hasColumn('day_seq')) {
			$table->addColumn('day_seq', Types::INTEGER, ['notnull' => true, 'default' => 0]);
		}

		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		// Pull every row's (id, user_id, flight_date) grouped so same-day legs are
		// adjacent and ordered by creation. Fetch fully before issuing updates so
		// we never interleave writes with an open read cursor across drivers.
		$select = $this->db->getQueryBuilder();
		$select->select('id', 'user_id', 'flight_date')
			->from('flightjournal_flights')
			->orderBy('user_id', 'ASC')
			->addOrderBy('flight_date', 'ASC')
			->addOrderBy('id', 'ASC');
		$result = $select->executeQuery();
		/** @var list<array{id: mixed, user_id: mixed, flight_date: mixed}> $rows */
		$rows = $result->fetchAll();
		$result->closeCursor();

		$currentKey = null;
		$seq = 0;
		$updated = 0;
		foreach ($rows as $row) {
			$key = (string)$row['user_id'] . '|' . (string)$row['flight_date'];
			if ($key !== $currentKey) {
				$currentKey = $key;
				$seq = 0;
			}
			$seq++;

			$update = $this->db->getQueryBuilder();
			$update->update('flightjournal_flights')
				->set('day_seq', $update->createNamedParameter($seq, IQueryBuilder::PARAM_INT))
				->where($update->expr()->eq('id', $update->createNamedParameter((int)$row['id'], IQueryBuilder::PARAM_INT)));
			$update->executeStatement();
			$updated++;
		}

		$output->info("Backfilled day_seq on $updated flight(s)");
	}
}
