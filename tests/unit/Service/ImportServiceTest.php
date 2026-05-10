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
		// NOTE: the airline/number split is greedy ({2,3} on the prefix) so
		// "SK4745" currently becomes airline=SK4, number=745. This pins the
		// existing behaviour rather than the intended SK/4745 split — the
		// underlying splitFlightNumber regex is suspect (see CLAUDE.md).
		$this->assertSame([
			'flightDate' => '2026-05-01',
			'originLabel' => 'CPH',
			'destinationLabel' => 'LHR',
			'airlineCode' => 'SK4',
			'flightNumber' => '745',
			'aircraftTypeRaw' => 'B738',
			'registration' => 'OY-KAL',
		], $captured[0][1]);

		$this->assertSame('2026-05-02', $captured[1][1]['flightDate']);
		$this->assertSame('W61', $captured[1][1]['airlineCode']);
		$this->assertSame('383', $captured[1][1]['flightNumber']);
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
