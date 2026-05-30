<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Adds a persisted great-circle distance (whole km) to each flight. Nullable:
 * existing rows and any flight whose endpoints don't both resolve to reference
 * coordinates stay NULL. Backfilled by re-running airport reconciliation
 * (Personal settings → recheck all, scope "all").
 *
 * @psalm-suppress UnusedClass
 * @psalm-suppress UndefinedDocblockClass
 */
class Version0002Date20260529000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		$schema = $schemaClosure();

		$table = $schema->getTable('flightjournal_flights');
		if (!$table->hasColumn('distance_km')) {
			$table->addColumn('distance_km', Types::INTEGER, ['notnull' => false]);
		}

		return $schema;
	}
}
