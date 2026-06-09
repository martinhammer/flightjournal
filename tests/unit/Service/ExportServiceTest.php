<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Service;

use OCA\FlightJournal\Db\Flight;
use OCA\FlightJournal\Service\ExportService;
use OCA\FlightJournal\Service\FlightService;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

class ExportServiceTest extends TestCase {
	private FlightService&MockObject $flights;
	private ExportService $exporter;

	protected function setUp(): void {
		parent::setUp();
		$this->flights = $this->createMock(FlightService::class);
		$this->exporter = new ExportService($this->flights);
	}

	private function makeFlight(): Flight {
		$flight = new Flight();
		$flight->setFlightDate('2026-05-01');
		$flight->setDaySeq(2);
		$flight->setOriginCode('CPH');
		$flight->setDestinationCode('LHR');
		$flight->setOriginLabel('Copenhagen Kastrup');
		$flight->setDestinationLabel('London Heathrow');
		$flight->setAirlineCode('SK');
		$flight->setFlightNumber('4745');
		$flight->setAircraftTypeRaw('B738');
		$flight->setRegistration('OY-KAL');
		$flight->setCabinClass('economy');
		$flight->setSeat('12A');
		$flight->setNotes('window');
		$flight->setDistanceKm(955);
		$flight->setCreatedAt(1700000000);
		$flight->setUpdatedAt(1700000500);
		return $flight;
	}

	public function testExportsJsonEnvelopeWithFlightFields(): void {
		$this->flights->method('findAll')->willReturn([$this->makeFlight()]);

		$json = $this->exporter->exportJson('alice');
		$decoded = json_decode($json, true);

		$this->assertSame('flightjournal', $decoded['app']);
		$this->assertSame(ExportService::JSON_FORMAT_VERSION, $decoded['version']);
		$this->assertArrayHasKey('exportedAt', $decoded);
		$this->assertCount(1, $decoded['flights']);

		$row = $decoded['flights'][0];
		$this->assertSame('2026-05-01', $row['flightDate']);
		$this->assertSame('CPH', $row['originCode']);
		$this->assertSame('London Heathrow', $row['destinationLabel']);
		$this->assertSame('economy', $row['cabinClass']);
		$this->assertSame('window', $row['notes']);
		// Ordering, distance and timestamps round-trip; only the surrogate id is dropped.
		$this->assertSame(2, $row['daySeq']);
		$this->assertSame(955, $row['distanceKm']);
		$this->assertSame(1700000000, $row['createdAt']);
		$this->assertSame(1700000500, $row['updatedAt']);
		$this->assertArrayNotHasKey('id', $row);
	}

	public function testEmptyExportStillProducesValidEnvelope(): void {
		$this->flights->method('findAll')->willReturn([]);
		$decoded = json_decode($this->exporter->exportJson('alice'), true);
		$this->assertSame([], $decoded['flights']);
	}
}
