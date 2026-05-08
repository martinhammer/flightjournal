<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * @psalm-suppress UnusedClass
 * @psalm-suppress UndefinedDocblockClass
 */
class Version0001Date20260508000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		$schema = $schemaClosure();

		if (!$schema->hasTable('flightjournal_flights')) {
			$table = $schema->createTable('flightjournal_flights');
			$table->addColumn('id', Types::BIGINT, [
				'autoincrement' => true,
				'notnull' => true,
			]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('flight_date', Types::DATE, ['notnull' => true]);
			$table->addColumn('origin_code', Types::STRING, ['notnull' => false, 'length' => 8]);
			$table->addColumn('destination_code', Types::STRING, ['notnull' => false, 'length' => 8]);
			$table->addColumn('origin_label', Types::STRING, ['notnull' => false, 'length' => 128]);
			$table->addColumn('destination_label', Types::STRING, ['notnull' => false, 'length' => 128]);
			$table->addColumn('airline_code', Types::STRING, ['notnull' => false, 'length' => 4]);
			$table->addColumn('flight_number', Types::STRING, ['notnull' => false, 'length' => 8]);
			$table->addColumn('aircraft_type_code', Types::STRING, ['notnull' => false, 'length' => 8]);
			$table->addColumn('aircraft_type_raw', Types::STRING, ['notnull' => false, 'length' => 64]);
			$table->addColumn('registration', Types::STRING, ['notnull' => false, 'length' => 16]);
			$table->addColumn('cabin_class', Types::STRING, ['notnull' => false, 'length' => 16]);
			$table->addColumn('seat', Types::STRING, ['notnull' => false, 'length' => 8]);
			$table->addColumn('notes', Types::TEXT, ['notnull' => false]);
			$table->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$table->addColumn('updated_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$table->setPrimaryKey(['id']);
			$table->addIndex(['user_id', 'flight_date'], 'fj_flights_user_date');
			$table->addIndex(['user_id', 'airline_code'], 'fj_flights_user_airline');
			$table->addIndex(['user_id', 'aircraft_type_code'], 'fj_flights_user_actype');
		}

		if (!$schema->hasTable('flightjournal_airports')) {
			$table = $schema->createTable('flightjournal_airports');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$table->addColumn('iata', Types::STRING, ['notnull' => false, 'length' => 4]);
			$table->addColumn('icao', Types::STRING, ['notnull' => false, 'length' => 4]);
			$table->addColumn('name', Types::STRING, ['notnull' => false, 'length' => 128]);
			$table->addColumn('city', Types::STRING, ['notnull' => false, 'length' => 64]);
			$table->addColumn('country_iso2', Types::STRING, ['notnull' => false, 'length' => 2]);
			$table->addColumn('lat', Types::FLOAT, ['notnull' => false]);
			$table->addColumn('lon', Types::FLOAT, ['notnull' => false]);
			$table->addColumn('tz', Types::STRING, ['notnull' => false, 'length' => 64]);
			$table->addColumn('source', Types::STRING, ['notnull' => false, 'length' => 32]);
			$table->addColumn('updated_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['iata'], 'fj_airports_iata');
			$table->addUniqueIndex(['icao'], 'fj_airports_icao');
		}

		if (!$schema->hasTable('flightjournal_aircraft_types')) {
			$table = $schema->createTable('flightjournal_aircraft_types');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$table->addColumn('icao_code', Types::STRING, ['notnull' => true, 'length' => 8]);
			$table->addColumn('iata_code', Types::STRING, ['notnull' => false, 'length' => 8]);
			$table->addColumn('manufacturer', Types::STRING, ['notnull' => false, 'length' => 64]);
			$table->addColumn('model', Types::STRING, ['notnull' => false, 'length' => 64]);
			$table->addColumn('variant', Types::STRING, ['notnull' => false, 'length' => 32]);
			$table->addColumn('engine_type', Types::STRING, ['notnull' => false, 'length' => 16]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['icao_code'], 'fj_actype_icao');
		}

		if (!$schema->hasTable('flightjournal_airlines')) {
			$table = $schema->createTable('flightjournal_airlines');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$table->addColumn('iata', Types::STRING, ['notnull' => false, 'length' => 4]);
			$table->addColumn('icao', Types::STRING, ['notnull' => false, 'length' => 4]);
			$table->addColumn('name', Types::STRING, ['notnull' => false, 'length' => 128]);
			$table->addColumn('country_iso2', Types::STRING, ['notnull' => false, 'length' => 2]);
			$table->addColumn('active', Types::BOOLEAN, ['notnull' => false, 'default' => true]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['iata'], 'fj_airlines_iata');
			$table->addUniqueIndex(['icao'], 'fj_airlines_icao');
		}

		if (!$schema->hasTable('flightjournal_enrichments')) {
			$table = $schema->createTable('flightjournal_enrichments');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$table->addColumn('flight_id', Types::BIGINT, ['notnull' => true]);
			$table->addColumn('provider', Types::STRING, ['notnull' => true, 'length' => 32]);
			$table->addColumn('kind', Types::STRING, ['notnull' => true, 'length' => 32]);
			$table->addColumn('payload', Types::TEXT, ['notnull' => false]);
			$table->addColumn('fetched_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['flight_id', 'provider', 'kind'], 'fj_enrich_unique');
			$table->addIndex(['flight_id'], 'fj_enrich_flight');
		}

		return $schema;
	}
}
