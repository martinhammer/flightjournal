<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Service;

use OCA\FlightJournal\Db\Flight;
use OCA\FlightJournal\Service\FlightService;
use OCA\FlightJournal\Service\ImportService;
use OCA\FlightJournal\Service\ValidationException;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

class ImportServiceTest extends TestCase {
	private FlightService&MockObject $flights;
	private ImportService $importer;

	protected function setUp(): void {
		parent::setUp();
		$this->flights = $this->createMock(FlightService::class);
		$this->importer = new ImportService($this->flights);
	}

	public function testImportsValidRows(): void {
		$markdown = <<<MD
		| Date       | Flight | Route   | Type    | Tail   |
		| ---------- | ------ | ------- | ------- | ------ |
		| 2026/05/01 | SK4745 | CPH-LHR | B738    | OY-KAL |
		| 2026-05-02 | W61383 | LHR-CPH | A320    | G-WUKA |
		MD;

		$captured = [];
		$this->flights->expects($this->exactly(2))
			->method('create')
			->willReturnCallback(function (string $userId, array $data) use (&$captured) {
				$captured[] = [$userId, $data];
				return new Flight();
			});

		$result = $this->importer->importMarkdownTable('alice', $markdown);

		$this->assertSame(2, $result['imported']);
		$this->assertSame([], $result['skipped']);

		$this->assertSame('alice', $captured[0][0]);
		// The airline prefix is exactly 2 characters; the rest is the flight
		// number — "SK4745" splits as SK/4745.
		$this->assertSame([
			'flightDate' => '2026-05-01',
			'originLabel' => 'CPH',
			'destinationLabel' => 'LHR',
			'airlineCode' => 'SK',
			'flightNumber' => '4745',
			'aircraftTypeRaw' => 'B738',
			'registration' => 'OY-KAL',
		], $captured[0][1]);

		$this->assertSame('2026-05-02', $captured[1][1]['flightDate']);
		$this->assertSame('W6', $captured[1][1]['airlineCode']);
		$this->assertSame('1383', $captured[1][1]['flightNumber']);
	}

	public function testWorksWithoutHeaderRow(): void {
		$markdown = '| 2026/05/01 | SK4745 | CPH-LHR | B738 | OY-KAL |';
		$this->flights->expects($this->once())->method('create')->willReturn(new Flight());
		$result = $this->importer->importMarkdownTable('alice', $markdown);
		$this->assertSame(1, $result['imported']);
	}

	public function testIgnoresBlankLinesAndHtmlComments(): void {
		$markdown = <<<MD

		<!-- a note -->
		| Date       | Flight | Route   | Type | Tail |
		| ---        | ---    | ---     | ---  | ---  |
		| 2026/05/01 | SK4745 | CPH-LHR | B738 | OY-KAL |

		MD;
		$this->flights->expects($this->once())->method('create')->willReturn(new Flight());
		$result = $this->importer->importMarkdownTable('alice', $markdown);
		$this->assertSame(1, $result['imported']);
		$this->assertSame([], $result['skipped']);
	}

	public function testTreatsNAAsNullForTypeAndTail(): void {
		$markdown = '| 2026/05/01 | SK4745 | CPH-LHR | N/A | n/a |';
		$captured = null;
		$this->flights->method('create')->willReturnCallback(function ($_u, $data) use (&$captured) {
			$captured = $data;
			return new Flight();
		});
		$this->importer->importMarkdownTable('alice', $markdown);
		$this->assertNull($captured['aircraftTypeRaw']);
		$this->assertNull($captured['registration']);
	}

	public function testNAFlightYieldsNullAirlineAndNumber(): void {
		$markdown = '| 2026/05/01 | N/A | CPH-LHR | B738 | OY-KAL |';
		$captured = null;
		$this->flights->method('create')->willReturnCallback(function ($_u, $data) use (&$captured) {
			$captured = $data;
			return new Flight();
		});
		$this->importer->importMarkdownTable('alice', $markdown);
		$this->assertNull($captured['airlineCode']);
		$this->assertNull($captured['flightNumber']);
	}

	public function testSkipsRowWithBadDate(): void {
		$markdown = <<<MD
		| Date     | Flight | Route   | Type | Tail   |
		| ---      | ---    | ---     | ---  | ---    |
		| 01-05-26 | SK4745 | CPH-LHR | B738 | OY-KAL |
		MD;
		$this->flights->expects($this->never())->method('create');
		$result = $this->importer->importMarkdownTable('alice', $markdown);
		$this->assertSame(0, $result['imported']);
		$this->assertCount(1, $result['skipped']);
		$this->assertStringContainsString('Unrecognized date', $result['skipped'][0]['reason']);
		$this->assertSame(3, $result['skipped'][0]['line']);
	}

	public function testSkipsRowWithBadRoute(): void {
		$markdown = '| 2026/05/01 | SK4745 | CPHLHR | B738 | OY-KAL |';
		$this->flights->expects($this->never())->method('create');
		$result = $this->importer->importMarkdownTable('alice', $markdown);
		$this->assertSame(0, $result['imported']);
		$this->assertCount(1, $result['skipped']);
		$this->assertStringContainsString('Unrecognized route', $result['skipped'][0]['reason']);
	}

	public function testSkipsRowWithTooFewColumns(): void {
		$markdown = '| 2026/05/01 | SK4745 | CPH-LHR |';
		$this->flights->expects($this->never())->method('create');
		$result = $this->importer->importMarkdownTable('alice', $markdown);
		$this->assertSame(0, $result['imported']);
		$this->assertCount(1, $result['skipped']);
		$this->assertStringContainsString('5 columns', $result['skipped'][0]['reason']);
	}

	public function testRecordsValidationFailureFromDownstream(): void {
		$markdown = '| 2026/05/01 | SK4745 | CPH-LHR | B738 | OY-KAL |';
		$this->flights->method('create')->willThrowException(new ValidationException('something invalid'));
		$result = $this->importer->importMarkdownTable('alice', $markdown);
		$this->assertSame(0, $result['imported']);
		$this->assertCount(1, $result['skipped']);
		$this->assertSame('something invalid', $result['skipped'][0]['reason']);
		$this->assertStringContainsString('SK4745', $result['skipped'][0]['raw']);
	}

	public function testMixedValidAndInvalidRowsBothReported(): void {
		$markdown = <<<MD
		| 2026/05/01 | SK4745 | CPH-LHR  | B738 | OY-KAL |
		| 2026/05/02 | W61383 | BADROUTE | A320 | G-WUKA |
		| 2026/05/03 | LH123  | FRA-MUC  | A320 | D-AIQA |
		MD;
		$this->flights->expects($this->exactly(2))->method('create')->willReturn(new Flight());
		$result = $this->importer->importMarkdownTable('alice', $markdown);
		$this->assertSame(2, $result['imported']);
		$this->assertCount(1, $result['skipped']);
		$this->assertSame(2, $result['skipped'][0]['line']);
	}

	public function testImportsJsonEnvelope(): void {
		$json = json_encode([
			'app' => 'flightjournal',
			'version' => 1,
			'flights' => [
				[
					'flightDate' => '2026-05-01',
					'daySeq' => 2,
					'originCode' => 'CPH',
					'destinationCode' => 'LHR',
					'originLabel' => 'Copenhagen Kastrup',
					'destinationLabel' => 'London Heathrow',
					'airlineCode' => 'SK',
					'flightNumber' => '4745',
					'aircraftTypeRaw' => 'B738',
					'registration' => 'OY-KAL',
					'cabinClass' => 'economy',
					'seat' => '12A',
					'notes' => 'window',
					'distanceKm' => 955,
					'createdAt' => 1700000000,
					'updatedAt' => 1700000500,
				],
			],
		]);

		$captured = null;
		$this->flights->expects($this->once())
			->method('restore')
			->willReturnCallback(function (string $userId, array $data) use (&$captured) {
				$captured = [$userId, $data];
				return new Flight();
			});

		$result = $this->importer->importJson('alice', (string)$json);

		$this->assertSame(1, $result['imported']);
		$this->assertSame([], $result['skipped']);
		$this->assertSame('alice', $captured[0]);
		$this->assertSame('2026-05-01', $captured[1]['flightDate']);
		$this->assertSame('CPH', $captured[1]['originCode']);
		$this->assertSame('London Heathrow', $captured[1]['destinationLabel']);
		$this->assertSame('economy', $captured[1]['cabinClass']);
		$this->assertSame('window', $captured[1]['notes']);
		// Numeric backup fields are passed through as ints.
		$this->assertSame(2, $captured[1]['daySeq']);
		$this->assertSame(955, $captured[1]['distanceKm']);
		$this->assertSame(1700000000, $captured[1]['createdAt']);
		$this->assertSame(1700000500, $captured[1]['updatedAt']);
	}

	public function testImportsBareJsonArray(): void {
		$json = json_encode([
			['flightDate' => '2026-05-01', 'originLabel' => 'CPH', 'destinationLabel' => 'LHR'],
			['flightDate' => '2026-05-02', 'originLabel' => 'LHR', 'destinationLabel' => 'CPH'],
		]);
		$this->flights->expects($this->exactly(2))->method('restore')->willReturn(new Flight());
		$result = $this->importer->importJson('alice', (string)$json);
		$this->assertSame(2, $result['imported']);
		$this->assertSame([], $result['skipped']);
		$this->assertSame(0, $result['deleted'], 'append by default deletes nothing');
	}

	public function testJsonImportWithReplaceWipesBeforeImporting(): void {
		$json = json_encode(['flights' => [
			['flightDate' => '2026-05-01', 'originLabel' => 'CPH', 'destinationLabel' => 'LHR'],
		]]);
		$this->flights->expects($this->once())->method('deleteAll')->with('alice')->willReturn(7);
		$this->flights->expects($this->once())->method('restore')->willReturn(new Flight());

		$result = $this->importer->importJson('alice', (string)$json, true);

		$this->assertSame(1, $result['imported']);
		$this->assertSame(7, $result['deleted']);
	}

	public function testJsonImportWithReplaceDoesNotWipeOnMalformedJson(): void {
		// A malformed payload must never delete existing data it then fails to replace.
		$this->flights->expects($this->never())->method('deleteAll');
		$this->flights->expects($this->never())->method('restore');
		$this->expectException(\InvalidArgumentException::class);
		$this->importer->importJson('alice', 'not json {', true);
	}

	public function testJsonImportOmitsNonNumericNumericFields(): void {
		// A bare/partial row without day_seq/distance leaves those keys unset so
		// restore() derives them rather than receiving a coerced 0.
		$json = json_encode(['flights' => [
			['flightDate' => '2026-05-01', 'originLabel' => 'CPH', 'destinationLabel' => 'LHR'],
		]]);
		$captured = null;
		$this->flights->method('restore')->willReturnCallback(function ($_u, array $data) use (&$captured) {
			$captured = $data;
			return new Flight();
		});
		$this->importer->importJson('alice', (string)$json);
		$this->assertArrayNotHasKey('daySeq', $captured);
		$this->assertArrayNotHasKey('distanceKm', $captured);
		$this->assertArrayNotHasKey('createdAt', $captured);
	}

	public function testJsonImportRejectsInvalidJson(): void {
		$this->flights->expects($this->never())->method('restore');
		$this->expectException(\InvalidArgumentException::class);
		$this->importer->importJson('alice', 'not json {');
	}

	public function testJsonImportRejectsNonListFlights(): void {
		$json = json_encode(['flights' => ['CPH' => ['flightDate' => '2026-05-01']]]);
		$this->expectException(\InvalidArgumentException::class);
		$this->importer->importJson('alice', (string)$json);
	}

	public function testJsonImportRecordsPerRowValidationFailure(): void {
		$json = json_encode(['flights' => [
			['flightDate' => '2026-05-01', 'originLabel' => 'CPH', 'destinationLabel' => 'LHR'],
			['flightDate' => 'bad', 'originLabel' => 'X', 'destinationLabel' => 'Y'],
		]]);
		$this->flights->method('restore')->willReturnCallback(function ($_u, array $data) {
			if ($data['flightDate'] === 'bad') {
				throw new ValidationException('flightDate must be YYYY-MM-DD');
			}
			return new Flight();
		});
		$result = $this->importer->importJson('alice', (string)$json);
		$this->assertSame(1, $result['imported']);
		$this->assertCount(1, $result['skipped']);
		$this->assertSame(2, $result['skipped'][0]['line']);
		$this->assertStringContainsString('YYYY-MM-DD', $result['skipped'][0]['reason']);
	}

	public function testFlightFallbackKeepsTokenWhenPatternFails(): void {
		// "ABCD" doesn't match the airline+digits pattern; falls through to "no airline split"
		$markdown = '| 2026/05/01 | ABCD | CPH-LHR | B738 | OY-KAL |';
		$captured = null;
		$this->flights->method('create')->willReturnCallback(function ($_u, $data) use (&$captured) {
			$captured = $data;
			return new Flight();
		});
		$this->importer->importMarkdownTable('alice', $markdown);
		$this->assertNull($captured['airlineCode']);
		$this->assertSame('ABCD', $captured['flightNumber']);
	}
}
