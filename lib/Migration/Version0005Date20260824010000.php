<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Widens `engine_type` to fit the real DOC 8643 values.
 *
 * Version0001 declared it varchar(16), which was a guess made before the source
 * data existed. The actual vocabulary is Jet / Piston / Rocket / Electric /
 * Turboprop/Turboshaft — and that last one is 20 characters, so every import
 * failed on its first row with "Data too long for column 'engine_type'".
 *
 * Measured maxima across all 7,388 source rows, for whenever these widths are
 * revisited: manufacturer 27/64, model 39/64, type_designator 4/8,
 * description 10/32, engine_type 20/16 (this fix), wtc 3/4.
 *
 * Implemented as drop + re-add rather than a column change because
 * Table::changeColumn/modifyColumn differs in name between the DBAL majors and
 * the OCP package does not stub Doctrine's Table. That is lossless here: no code
 * wrote to `flightjournal_aircraft_types` before the release that added
 * AircraftTypeImportService, and that importer has never completed a row — the
 * too-long value is exactly what stopped it — so the column has never held data
 * on any instance.
 *
 * @psalm-suppress UnusedClass
 * @psalm-suppress UndefinedDocblockClass
 */
class Version0005Date20260824010000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		$schema = $schemaClosure();

		$table = $schema->getTable('flightjournal_aircraft_types');
		if ($table->hasColumn('engine_type')) {
			$table->dropColumn('engine_type');
		}
		$table->addColumn('engine_type', Types::STRING, ['notnull' => false, 'length' => 32]);

		return $schema;
	}
}
