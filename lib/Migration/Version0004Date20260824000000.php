<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Re-grains the aircraft reference table and gives flights a place to record
 * which specific model they were flown on.
 *
 * `flightjournal_aircraft_types` was created (Version0001) with one row per ICAO
 * designator. That grain is wrong for the source data: in DOC 8643 a designator
 * maps to *many* models — 1,377 of 2,688 designators have more than one, and
 * collapsing them at import throws away exactly the rows a disambiguation UI
 * needs to offer. So the table moves to model grain:
 *
 *   - `icao_code` loses its unique index and keeps a plain one (it is now the
 *     grouping key, not the identity).
 *   - `(manufacturer, model)` becomes the unique natural key — verified globally
 *     unique across all 7,388 source rows, and needed in full because `model`
 *     alone fails to identify a row within its designator for 629 designators.
 *   - `canonical` marks the default row for a designator, computed at import by
 *     a deterministic rank so a re-import cannot silently flip the pick.
 *   - `engine_type` / `engine_count` / `wtc` / `description` are functionally
 *     determined by the designator (0 rows in the source disagree), so they
 *     repeat harmlessly across a designator's models. There is no partial-update
 *     path that could desync them — import replaces wholesale.
 *   - `variant` is dropped: DOC 8643 folds the variant into the model string
 *     ("787-9 Dreamliner"), so the column has no source and would stay NULL.
 *
 * On the flight side, reconciliation denormalises the resolved model onto the
 * row (`aircraft_manufacturer` / `aircraft_model`), exactly as airport
 * reconciliation copies the reference airport name into `origin_label`. That
 * keeps the list endpoint join-free and makes the flight self-sufficient when
 * the reference table is absent or wiped. Deliberately a natural key rather than
 * a reference id: surrogate ids do not survive re-import and are meaningless in
 * a JSON backup restored on another instance.
 *
 * Safe without a data-preserving path: no code has ever written to
 * `flightjournal_aircraft_types`, so it is empty on every instance.
 *
 * @psalm-suppress UnusedClass
 * @psalm-suppress UndefinedDocblockClass
 */
class Version0004Date20260824000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		$schema = $schemaClosure();

		$types = $schema->getTable('flightjournal_aircraft_types');

		// Identity moves from the designator to (manufacturer, model).
		if ($types->hasIndex('fj_actype_icao')) {
			$types->dropIndex('fj_actype_icao');
		}
		if (!$types->hasIndex('fj_actype_desig')) {
			$types->addIndex(['icao_code'], 'fj_actype_desig');
		}

		// manufacturer/model stay nullable as created: the existing varchar(64) is
		// already wide enough (max observed 27 / 39 chars), and tightening them
		// would need Table::changeColumn/modifyColumn, whose name differs between
		// the DBAL majors and which the OCP package does not stub. Presence of both
		// halves of the natural key is enforced in AircraftTypeImportService, where
		// validation belongs anyway.
		if ($types->hasColumn('variant')) {
			$types->dropColumn('variant');
		}
		if (!$types->hasColumn('engine_count')) {
			$types->addColumn('engine_count', Types::INTEGER, ['notnull' => false]);
		}
		if (!$types->hasColumn('wtc')) {
			$types->addColumn('wtc', Types::STRING, ['notnull' => false, 'length' => 4]);
		}
		if (!$types->hasColumn('description')) {
			$types->addColumn('description', Types::STRING, ['notnull' => false, 'length' => 32]);
		}
		if (!$types->hasColumn('canonical')) {
			$types->addColumn('canonical', Types::BOOLEAN, ['notnull' => true, 'default' => false]);
		}
		if (!$types->hasColumn('source')) {
			$types->addColumn('source', Types::STRING, ['notnull' => false, 'length' => 32]);
		}
		if (!$types->hasColumn('updated_at')) {
			$types->addColumn('updated_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
		}

		if (!$types->hasIndex('fj_actype_model')) {
			$types->addUniqueIndex(['manufacturer', 'model'], 'fj_actype_model');
		}
		// Serving the canonical lookup (designator -> its one default row).
		if (!$types->hasIndex('fj_actype_canon')) {
			$types->addIndex(['icao_code', 'canonical'], 'fj_actype_canon');
		}

		$flights = $schema->getTable('flightjournal_flights');
		if (!$flights->hasColumn('aircraft_manufacturer')) {
			$flights->addColumn('aircraft_manufacturer', Types::STRING, ['notnull' => false, 'length' => 64]);
		}
		if (!$flights->hasColumn('aircraft_model')) {
			$flights->addColumn('aircraft_model', Types::STRING, ['notnull' => false, 'length' => 64]);
		}

		return $schema;
	}
}
