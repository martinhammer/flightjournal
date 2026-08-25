<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Migration;

use Closure;
use OCA\FlightJournal\Service\AircraftModelKey;
use OCP\DB\ISchemaWrapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\DB\Types;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Adds the punctuation-insensitive lookup key used by the third aircraft
 * reconciliation tier, so "A320neo" reaches DOC 8643's "A-320neo".
 *
 * Stored as a column rather than computed in SQL so the lookup is indexed and
 * portable — stripping separators with nested REPLACE() would work across the
 * supported databases but could not use an index, turning each lookup into a
 * full scan of ~7,400 rows.
 *
 * postSchemaChange backfills from the existing `model` values, so an instance
 * that has already imported its reference data does not need to re-import for
 * the option to work.
 *
 * @psalm-suppress UnusedClass
 * @psalm-suppress UndefinedDocblockClass
 */
class Version0006Date20260824020000 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		$schema = $schemaClosure();

		$table = $schema->getTable('flightjournal_aircraft_types');
		if (!$table->hasColumn('model_normalized')) {
			$table->addColumn('model_normalized', Types::STRING, ['notnull' => false, 'length' => 64]);
		}
		if (!$table->hasIndex('fj_actype_nmodel')) {
			$table->addIndex(['model_normalized'], 'fj_actype_nmodel');
		}

		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		// Fetch fully before issuing updates so we never interleave writes with an
		// open read cursor across drivers (same reasoning as Version0003).
		$select = $this->db->getQueryBuilder();
		$select->select('id', 'model')
			->from('flightjournal_aircraft_types');
		$result = $select->executeQuery();
		/** @var list<array{id: mixed, model: mixed}> $rows */
		$rows = $result->fetchAll();
		$result->closeCursor();

		$updated = 0;
		foreach ($rows as $row) {
			$key = AircraftModelKey::normalize(is_string($row['model']) ? $row['model'] : null);

			$update = $this->db->getQueryBuilder();
			$update->update('flightjournal_aircraft_types')
				->set('model_normalized', $update->createNamedParameter($key === '' ? null : $key))
				->where($update->expr()->eq('id', $update->createNamedParameter((int)$row['id'], IQueryBuilder::PARAM_INT)));
			$update->executeStatement();
			$updated++;
		}

		$output->info("Backfilled model_normalized on $updated aircraft type(s)");
	}
}
