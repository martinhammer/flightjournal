<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Service;

use OCA\FlightJournal\Db\AircraftType;
use OCA\FlightJournal\Db\AircraftTypeMapper;
use OCA\FlightJournal\Service\AircraftReconciliationService;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

class AircraftReconciliationServiceTest extends TestCase {
	private AircraftTypeMapper&MockObject $mapper;
	private AircraftReconciliationService $service;

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = $this->createMock(AircraftTypeMapper::class);
		$this->service = new AircraftReconciliationService($this->mapper);
	}

	private function row(string $designator, string $manufacturer, string $model): AircraftType {
		$row = new AircraftType();
		$row->setIcaoCode($designator);
		$row->setManufacturer($manufacturer);
		$row->setModel($model);
		return $row;
	}

	public function testResolvesDesignatorToCanonicalModel(): void {
		$this->mapper->method('findCanonicalByDesignator')
			->with('B738')
			->willReturn($this->row('B738', 'BOEING', '737-800'));

		$match = $this->service->resolve('B738');

		$this->assertNotNull($match);
		$this->assertSame('B738', $match->code);
		$this->assertSame('BOEING', $match->manufacturer);
		$this->assertSame('737-800', $match->model);
	}

	public function testFallsBackToModelNameWhenDesignatorMisses(): void {
		$this->mapper->method('findCanonicalByDesignator')->willReturn(null);
		$this->mapper->method('findOneByModelName')
			->with('737-800')
			->willReturn($this->row('B738', 'BOEING', '737-800'));

		$match = $this->service->resolve('737-800');

		$this->assertNotNull($match);
		$this->assertSame('B738', $match->code);
	}

	/**
	 * 1,034 model strings are shared by more than one manufacturer, so an
	 * ambiguous name must resolve to nothing rather than guess. The mapper
	 * signals that by returning null.
	 */
	public function testAmbiguousModelNameResolvesToNothing(): void {
		$this->mapper->method('findCanonicalByDesignator')->willReturn(null);
		$this->mapper->method('findOneByModelName')->willReturn(null);

		$this->assertNull($this->service->resolve('DHC-6 Twin Otter'));
	}

	public function testTrimsAndUppercasesTheResolvedCode(): void {
		// The input is trimmed before it reaches the mapper, and the code coming
		// back out of the reference row is trimmed and uppercased.
		$this->mapper->method('findCanonicalByDesignator')
			->with('b738')
			->willReturn($this->row(' b738 ', 'BOEING', '737-800'));

		$match = $this->service->resolve('  b738  ');

		$this->assertNotNull($match);
		$this->assertSame('B738', $match->code);
	}

	public function testNullAndBlankInputResolveToNothing(): void {
		$this->mapper->expects($this->never())->method('findCanonicalByDesignator');

		$this->assertNull($this->service->resolve(null));
		$this->assertNull($this->service->resolve('   '));
	}

	/**
	 * resolveDesignator is what the bulk recheck uses. It must NOT fall through
	 * to the model-name tier — a stored code is authoritative and should never be
	 * re-guessed from text that happens to look like a model.
	 */
	public function testResolveDesignatorDoesNotFallBackToModelName(): void {
		$this->mapper->method('findCanonicalByDesignator')->willReturn(null);
		$this->mapper->expects($this->never())->method('findOneByModelName');

		$this->assertNull($this->service->resolveDesignator('B738'));
	}

	public function testResolveDesignatorReturnsCanonicalModel(): void {
		$this->mapper->method('findCanonicalByDesignator')
			->willReturn($this->row('B789', 'BOEING', '787-9 Dreamliner'));

		$match = $this->service->resolveDesignator('B789');

		$this->assertNotNull($match);
		$this->assertSame('787-9 Dreamliner', $match->model);
	}

	// ---- Punctuation-insensitive tier (opt-in) -------------------------------

	public function testPunctuationTierIsOffByDefault(): void {
		$this->mapper->method('findCanonicalByDesignator')->willReturn(null);
		$this->mapper->method('findOneByModelName')->willReturn(null);
		$this->mapper->expects($this->never())->method('findOneByNormalizedModel');

		$this->assertNull($this->service->resolve('A320neo'));
	}

	public function testPunctuationTierMatchesASeparatorVariant(): void {
		$this->mapper->method('findCanonicalByDesignator')->willReturn(null);
		$this->mapper->method('findOneByModelName')->willReturn(null);
		$this->mapper->method('findOneByNormalizedModel')
			->with('a320neo')
			->willReturn($this->row('A20N', 'AIRBUS', 'A-320neo'));

		$match = $this->service->resolve('A320neo', true);

		$this->assertNotNull($match);
		$this->assertSame('A20N', $match->code);
		$this->assertSame('A-320neo', $match->model);
	}

	/**
	 * The strict tiers still win, so enabling the option can never change a
	 * result that already resolved exactly.
	 */
	public function testPunctuationTierIsOnlyConsultedAfterTheStrictTiers(): void {
		$this->mapper->method('findCanonicalByDesignator')
			->willReturn($this->row('B738', 'BOEING', '737-800'));
		$this->mapper->expects($this->never())->method('findOneByNormalizedModel');

		$match = $this->service->resolve('B738', true);

		$this->assertNotNull($match);
		$this->assertSame('737-800', $match->model);
	}

	public function testPunctuationTierStillRequiresAnUnambiguousMatch(): void {
		$this->mapper->method('findCanonicalByDesignator')->willReturn(null);
		$this->mapper->method('findOneByModelName')->willReturn(null);
		// The mapper returns null for an ambiguous key, exactly as the exact tier does.
		$this->mapper->method('findOneByNormalizedModel')->willReturn(null);

		$this->assertNull($this->service->resolve('SeaStar', true));
	}

	public function testBlankReferenceFieldsBecomeNull(): void {
		$this->mapper->method('findCanonicalByDesignator')
			->willReturn($this->row('B738', '  ', ''));

		$match = $this->service->resolve('B738');

		$this->assertNotNull($match);
		$this->assertNull($match->manufacturer);
		$this->assertNull($match->model);
	}
}
