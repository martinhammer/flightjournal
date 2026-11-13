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

	/** @var list<string> What the stand-in transaction did, in order. */
	private array $log = [];

	protected function setUp(): void {
		parent::setUp();
		$this->inserted = [];
		$this->log = [];
		$this->mapper = $this->mapperMock();
		// Empty table: every row is an insert, captured for assertion.
		$this->mapper->method('findOneByModel')->willReturn(null);
		$this->mapper->method('insert')->willReturnCallback(function (AircraftType $e): AircraftType {
			$this->inserted[] = $e;
			return $e;
		});
		$this->service = new AircraftTypeImportService($this->mapper);
	}

	/**
	 * A mapper mock whose transactional() runs its callback and logs whether it
	 * committed or rolled back, as the real atomic() does.
	 */
	private function mapperMock(): AircraftTypeMapper&MockObject {
		$mapper = $this->createMock(AircraftTypeMapper::class);
		$mapper->method('transactional')->willReturnCallback(function (callable $fn) {
			$this->log[] = 'begin';
			try {
				$result = $fn();
			} catch (\Throwable $e) {
				$this->log[] = 'rollback';
				throw $e;
			}
			$this->log[] = 'commit';
			return $result;
		});
		return $mapper;
	}

	/**
	 * A mapper over an in-memory table, for re-import tests that need the flags
	 * as stored rather than as written: findOneByModel, insert, update and
	 * clearCanonical all act on $table.
	 *
	 * @param list<AircraftType> $table
	 */
	private function serviceOverTable(array &$table): AircraftTypeImportService {
		$mapper = $this->mapperMock();
		$mapper->method('findOneByModel')->willReturnCallback(function (string $manufacturer, string $model) use (&$table) {
			foreach ($table as $row) {
				if ($row->getManufacturer() === $manufacturer && $row->getModel() === $model) {
					return $row;
				}
			}
			return null;
		});
		$mapper->method('insert')->willReturnCallback(function (AircraftType $e) use (&$table) {
			$table[] = $e;
			return $e;
		});
		$mapper->method('update')->willReturnArgument(0);
		$mapper->method('clearCanonical')->willReturnCallback(function (array $designators) use (&$table): void {
			$this->log[] = 'clear ' . implode(',', $designators);
			foreach ($table as $row) {
				if (in_array($row->getIcaoCode(), $designators, true)) {
					$row->setCanonical(false);
				}
			}
		});
		return new AircraftTypeImportService($mapper);
	}

	private static function stored(string $designator, string $manufacturer, string $model, bool $canonical): AircraftType {
		$row = new AircraftType();
		$row->setIcaoCode($designator);
		$row->setManufacturer($manufacturer);
		$row->setModel($model);
		$row->setCanonical($canonical);
		return $row;
	}

	/**
	 * @param list<AircraftType> $table
	 * @return list<string> "MANUFACTURER model" of each canonical row for $designator
	 */
	private static function canonicalsIn(array $table, string $designator): array {
		$names = [];
		foreach ($table as $row) {
			if ($row->getIcaoCode() === $designator && $row->getCanonical()) {
				$names[] = $row->getManufacturer() . ' ' . $row->getModel();
			}
		}
		return $names;
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

	// ---- Stage 1: digit containment ------------------------------------------

	/**
	 * The case the digit filter exists for: shortest-name alone picked the
	 * military "C-40" over the airliner, because a designator often also covers
	 * unrelated types with shorter names.
	 */
	public function testDesignatorDigitsBeatAShorterUnrelatedName(): void {
		$this->service->importCsv($this->csv(
			'BOEING,C-40,B737,LandPlane,Jet,2,M',
			'BOEING,737-700,B737,LandPlane,Jet,2,M',
			'BOEING,737-700 BBJ,B737,LandPlane,Jet,2,M',
			'BOEING,C-40 Clipper,B737,LandPlane,Jet,2,M',
		));
		$this->assertSame(['BOEING', '737-700'], $this->canonicalOf('B737'));
	}

	/**
	 * "332" is not a *substring* of "330200" but is a subsequence — the reason
	 * the comparison is ordered-subsequence rather than substring.
	 */
	public function testDigitsAreMatchedAsAnOrderedSubsequence(): void {
		$this->service->importCsv($this->csv(
			'AIRBUS,T-24,A332,LandPlane,Jet,2,H',
			'AIRBUS,A-330-200,A332,LandPlane,Jet,2,H',
			'AIRBUS,A-330-200 Prestige,A332,LandPlane,Jet,2,H',
			'AIRBUS,A-330-MRTT,A332,LandPlane,Jet,2,H',
			'AIRBUS,KC-30,A332,LandPlane,Jet,2,H',
		));
		// A-330-MRTT has digits "330" and so fails on the trailing 2.
		$this->assertSame(['AIRBUS', 'A-330-200'], $this->canonicalOf('A332'));
	}

	public function testDigitFilterAlsoFixesTheRegionalJetCase(): void {
		$this->service->importCsv($this->csv(
			'CANADAIR,CL-600 Challenger 890,CRJ9,LandPlane,Jet,2,M',
			'CANADAIR,CL-600 Regional Jet CRJ-705,CRJ9,LandPlane,Jet,2,M',
			'CANADAIR,CL-600 Regional Jet CRJ-900,CRJ9,LandPlane,Jet,2,M',
		));
		$this->assertSame(['CANADAIR', 'CL-600 Regional Jet CRJ-900'], $this->canonicalOf('CRJ9'));
	}

	/**
	 * A filter may narrow the field but never empty it — otherwise a designator
	 * whose models all fail the digit test would have no default at all.
	 */
	public function testDigitFilterIsSkippedWhenNoModelCarriesTheDigits(): void {
		$this->service->importCsv($this->csv(
			'CESSNA,Skyhawk,X999,LandPlane,Piston,1,L',
			'CESSNA,Skylane,X999,LandPlane,Piston,1,L',
		));
		$this->assertSame(['CESSNA', 'Skyhawk'], $this->canonicalOf('X999'));
	}

	public function testDigitFilterIsInertForALetterOnlyDesignator(): void {
		$this->service->importCsv($this->csv(
			'SCHEMPP-HIRTH,Discus 2,GLID,LandPlane,Piston,1,L',
			'SCHEMPP-HIRTH,Nimbus,GLID,LandPlane,Piston,1,L',
		));
		// No digits to match on, so the shortest name still wins.
		$this->assertSame(['SCHEMPP-HIRTH', 'Nimbus'], $this->canonicalOf('GLID'));
	}

	/**
	 * Filter order is load-bearing for exactly this designator: `CC-` is in the
	 * derivative list for the CC-138 Twin Otter and falsely flags Cub Crafters.
	 * Filtering on digits first keeps the correct model; demoting first would
	 * strand the group on "CCK-1865 Carbon Cub".
	 */
	public function testDigitFilterRunsBeforeDerivativeDemotion(): void {
		$this->service->importCsv($this->csv(
			'CUB CRAFTERS,CC-11 Sport Cub,CC11,LandPlane,Piston,1,L',
			'CUB CRAFTERS,CCK-1865 Carbon Cub,CC11,LandPlane,Piston,1,L',
		));
		$this->assertSame(['CUB CRAFTERS', 'CC-11 Sport Cub'], $this->canonicalOf('CC11'));
	}

	// ---- Stages 2-4 ----------------------------------------------------------

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

		$mapper = $this->mapperMock();
		$mapper->method('findOneByModel')->willReturn($existing);
		$mapper->expects($this->never())->method('insert');
		$mapper->expects($this->once())->method('update')->with($existing);

		$service = new AircraftTypeImportService($mapper);
		$result = $service->importCsv($this->csv('BOEING,737-800,B738,LandPlane,Jet,2,M'));

		$this->assertSame(0, $result['imported']);
		$this->assertSame(1, $result['updated']);
	}

	// ---- Re-import: the file decides the default -----------------------------

	public function testReImportDemotesADefaultTheFileNoLongerLists(): void {
		// A newer extract dropped the old default. Upsert never deletes it, so
		// without clearing it would stay canonical beside the new pick.
		$table = [self::stored('B738', 'BOEING', '737-800 (old name)', true)];
		$service = $this->serviceOverTable($table);

		$service->importCsv($this->csv(
			'BOEING,737-800,B738,LandPlane,Jet,2,M',
			'BOEING,737-800 BBJ2,B738,LandPlane,Jet,2,M',
		));

		$this->assertSame(['BOEING 737-800'], self::canonicalsIn($table, 'B738'));
		$this->assertCount(3, $table, 'the dropped row is kept, just no longer the default');
	}

	public function testReImportMovesTheDefaultWhenTheRankingChanges(): void {
		// The old default is still in the file but now ranks lower.
		$table = [
			self::stored('B738', 'BOEING', '737-800 BBJ2', true),
			self::stored('B738', 'BOEING', '737-800', false),
		];
		$service = $this->serviceOverTable($table);

		$service->importCsv($this->csv(
			'BOEING,737-800 BBJ2,B738,LandPlane,Jet,2,M',
			'BOEING,737-800,B738,LandPlane,Jet,2,M',
		));

		$this->assertSame(['BOEING 737-800'], self::canonicalsIn($table, 'B738'));
	}

	public function testReImportLeavesDesignatorsTheFileDoesNotMention(): void {
		// A partial file only speaks for the designators it lists.
		$table = [
			self::stored('A332', 'AIRBUS', 'A-330-200', true),
			self::stored('B738', 'BOEING', '737-800', true),
		];
		$service = $this->serviceOverTable($table);

		$service->importCsv($this->csv('BOEING,737-800,B738,LandPlane,Jet,2,M'));

		$this->assertSame(['AIRBUS A-330-200'], self::canonicalsIn($table, 'A332'));
		$this->assertSame(['BOEING 737-800'], self::canonicalsIn($table, 'B738'));
		$this->assertSame(['begin', 'clear B738', 'commit'], $this->log);
	}

	public function testImportClearsAndWritesInsideOneTransaction(): void {
		$this->mapper->method('clearCanonical')->willReturnCallback(function (array $designators): void {
			$this->log[] = 'clear ' . implode(',', $designators);
		});

		$this->service->importCsv($this->csv(
			'BOEING,737-800,B738,LandPlane,Jet,2,M',
			'AIRBUS,A-330-200,A332,LandPlane,Jet,2,H',
		));

		$this->assertSame(['begin', 'clear B738,A332', 'commit'], $this->log);
	}

	public function testAFailedImportRollsBackTheClearedFlags(): void {
		$mapper = $this->mapperMock();
		$mapper->method('findOneByModel')->willReturn(null);
		$mapper->method('clearCanonical')->willReturnCallback(function (): void {
			$this->log[] = 'clear';
		});
		$mapper->method('insert')->willThrowException(new \RuntimeException('value too long'));
		$service = new AircraftTypeImportService($mapper);

		try {
			$service->importCsv($this->csv('BOEING,737-800,B738,LandPlane,Jet,2,M'));
			$this->fail('the database error should propagate');
		} catch (\RuntimeException) {
		}
		$this->assertSame(['begin', 'clear', 'rollback'], $this->log);
	}
}
