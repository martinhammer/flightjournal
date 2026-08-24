<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Service;

use OCA\FlightJournal\Db\AircraftType;
use OCA\FlightJournal\Db\AircraftTypeMapper;
use OCA\FlightJournal\Service\AircraftTypeImportService;
use OCA\FlightJournal\Service\ValidationException;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

class AircraftTypeImportServiceTest extends TestCase {
	private const HEADER = 'manufacturer,model,type_designator,description,engine_type,engine_count,wtc';

	private AircraftTypeMapper&MockObject $mapper;
	private AircraftTypeImportService $service;
	/** @var list<AircraftType> */
	private array $inserted = [];

	protected function setUp(): void {
		parent::setUp();
		$this->inserted = [];
		$this->mapper = $this->createMock(AircraftTypeMapper::class);
		// Empty table: every row is an insert, captured for assertion.
		$this->mapper->method('findOneByModel')->willReturn(null);
		$this->mapper->method('insert')->willReturnCallback(function (AircraftType $e): AircraftType {
			$this->inserted[] = $e;
			return $e;
		});
		$this->service = new AircraftTypeImportService($this->mapper);
	}

	private function csv(string ...$rows): string {
		return self::HEADER . "\n" . implode("\n", $rows) . "\n";
	}

	/** @return array{0: string, 1: string} the canonical [manufacturer, model] */
	private function canonicalOf(string $designator): array {
		foreach ($this->inserted as $row) {
			if ($row->getIcaoCode() === $designator && $row->getCanonical()) {
				return [(string)$row->getManufacturer(), (string)$row->getModel()];
			}
		}
		$this->fail("No canonical row for $designator");
	}

	public function testImportsEveryModelSharingADesignator(): void {
		$result = $this->service->importCsv($this->csv(
			'BOEING,777-300ER,B77W,LandPlane,Jet,2,H',
			'BOEING,777-300ER BBJ,B77W,LandPlane,Jet,2,H',
		));

		// The grain is the model: both rows survive rather than collapsing.
		$this->assertSame(2, $result['imported']);
		$this->assertCount(2, $this->inserted);
		$this->assertSame([], $result['skipped']);
	}

	public function testExactlyOneRowPerDesignatorIsCanonical(): void {
		$this->service->importCsv($this->csv(
			'DE HAVILLAND CANADA,DHC-6 Twin Otter,DHC6,LandPlane,Turboprop/Turboshaft,2,L',
			'DE HAVILLAND CANADA,CC-138 Twin Otter,DHC6,LandPlane,Turboprop/Turboshaft,2,L',
			'VIKING (2),DHC-6 Twin Otter,DHC6,LandPlane,Turboprop/Turboshaft,2,L',
		));

		$canonicals = array_filter($this->inserted, fn (AircraftType $r): bool => $r->getCanonical());
		$this->assertCount(1, $canonicals);
	}

	public function testShortestModelWinsTheCanonicalSlot(): void {
		$this->service->importCsv($this->csv(
			'BOEING,737-800 BBJ2,B738,LandPlane,Jet,2,M',
			'BOEING,737-800,B738,LandPlane,Jet,2,M',
		));
		$this->assertSame(['BOEING', '737-800'], $this->canonicalOf('B738'));
	}

	/**
	 * The whole reason the demotion rule exists: shortest-model alone picks the
	 * private-jet conversion over the airliner a journal user actually flew.
	 */
	public function testCorporateDerivativeIsDemotedEvenThoughItsNameIsShorter(): void {
		$this->service->importCsv($this->csv(
			'BOEING,787-9 BBJ,B789,LandPlane,Jet,2,H',
			'BOEING,787-9 Dreamliner,B789,LandPlane,Jet,2,H',
		));
		$this->assertSame(['BOEING', '787-9 Dreamliner'], $this->canonicalOf('B789'));
	}

	public function testMilitaryDerivativeIsDemoted(): void {
		$this->service->importCsv($this->csv(
			'ATR,ATR P-72,AT76,LandPlane,Turboprop/Turboshaft,2,M',
			'ATR,ATR-72-600,AT76,LandPlane,Turboprop/Turboshaft,2,M',
		));
		$this->assertSame(['ATR', 'ATR-72-600'], $this->canonicalOf('AT76'));
	}

	/**
	 * A designator whose models are *all* derivatives still needs a default —
	 * demotion must not eliminate every candidate.
	 */
	public function testAllDerivativeDesignatorStillGetsACanonicalRow(): void {
		$this->service->importCsv($this->csv(
			'BOEING,737-700 BBJ,BBJ1,LandPlane,Jet,2,M',
			'BOEING,737-700 BBJ Elite,BBJ1,LandPlane,Jet,2,M',
		));
		$this->assertSame(['BOEING', '737-700 BBJ'], $this->canonicalOf('BBJ1'));
	}

	/**
	 * Shortest-model ties in roughly half of all ambiguous designators, so the
	 * alphabetical tiebreak is what makes the pick independent of file order —
	 * without it a re-import could silently move the canonical row.
	 */
	public function testCanonicalPickIsIndependentOfRowOrder(): void {
		$rows = [
			'ZZZ AVIATION,Model X,TIE1,LandPlane,Piston,1,L',
			'AAA AVIATION,Model Y,TIE1,LandPlane,Piston,1,L',
			'MMM AVIATION,Model Z,TIE1,LandPlane,Piston,1,L',
		];
		$this->service->importCsv($this->csv(...$rows));
		$first = $this->canonicalOf('TIE1');

		$this->inserted = [];
		$this->service->importCsv($this->csv(...array_reverse($rows)));
		$this->assertSame($first, $this->canonicalOf('TIE1'));
	}

	public function testMapsColumnsByNameNotPosition(): void {
		$content = "wtc,type_designator,model,manufacturer,engine_count,engine_type,description\n"
			. "M,B738,737-800,BOEING,2,Jet,LandPlane\n";
		$this->service->importCsv($content);

		$row = $this->inserted[0];
		$this->assertSame('B738', $row->getIcaoCode());
		$this->assertSame('BOEING', $row->getManufacturer());
		$this->assertSame('737-800', $row->getModel());
		$this->assertSame('Jet', $row->getEngineType());
		$this->assertSame(2, $row->getEngineCount());
		$this->assertSame('M', $row->getWtc());
	}

	public function testUppercasesTheDesignator(): void {
		$this->service->importCsv($this->csv('BOEING,737-800,b738,LandPlane,Jet,2,M'));
		$this->assertSame('B738', $this->inserted[0]->getIcaoCode());
	}

	public function testSkipsRowsMissingHalfTheNaturalKey(): void {
		$result = $this->service->importCsv($this->csv(
			'BOEING,737-800,B738,LandPlane,Jet,2,M',
			',737-900,B739,LandPlane,Jet,2,M',
			'BOEING,,B77W,LandPlane,Jet,2,H',
		));

		$this->assertSame(1, $result['imported']);
		$this->assertCount(2, $result['skipped']);
		$this->assertSame('Missing manufacturer or model', $result['skipped'][0]['reason']);
	}

	public function testSkipsRowWithoutDesignator(): void {
		$result = $this->service->importCsv($this->csv('BOEING,737-800,,LandPlane,Jet,2,M'));

		$this->assertSame(0, $result['imported']);
		$this->assertSame([
			['key' => 'BOEING 737-800', 'reason' => 'Missing type_designator'],
		], $result['skipped']);
	}

	public function testRejectsFileMissingARequiredColumn(): void {
		$this->expectException(ValidationException::class);
		$this->expectExceptionMessage('Missing required column: type_designator');
		$this->service->importCsv("manufacturer,model,engine_type\nBOEING,737-800,Jet\n");
	}

	public function testRejectsEmptyFile(): void {
		$this->expectException(ValidationException::class);
		$this->service->importCsv('');
	}

	public function testUpdatesExistingRowInsteadOfDuplicating(): void {
		$existing = new AircraftType();
		$existing->setIcaoCode('B738');
		$existing->setManufacturer('BOEING');
		$existing->setModel('737-800');

		$mapper = $this->createMock(AircraftTypeMapper::class);
		$mapper->method('findOneByModel')->willReturn($existing);
		$mapper->expects($this->never())->method('insert');
		$mapper->expects($this->once())->method('update')->with($existing);

		$service = new AircraftTypeImportService($mapper);
		$result = $service->importCsv($this->csv('BOEING,737-800,B738,LandPlane,Jet,2,M'));

		$this->assertSame(0, $result['imported']);
		$this->assertSame(1, $result['updated']);
	}
}
