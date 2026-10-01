<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Controller;

use OCA\FlightJournal\Controller\AirportApiController;
use OCA\FlightJournal\Db\AirportMapper;
use OCA\FlightJournal\Db\FlightMapper;
use OCA\FlightJournal\Service\AirportMatch;
use OCA\FlightJournal\Service\AirportReconciliationService;
use OCP\IRequest;
use OCP\IUserSession;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * The resolve preview must report what reconciliation will do, so it goes
 * through the one resolver — and must tell an empty reference table apart from
 * a genuine miss, since the bulk editor warns differently for each.
 */
class AirportApiControllerTest extends TestCase {
	private AirportMapper&MockObject $airports;
	private AirportReconciliationService&MockObject $reconciler;
	private AirportApiController $controller;

	protected function setUp(): void {
		parent::setUp();
		$this->airports = $this->createMock(AirportMapper::class);
		$this->reconciler = $this->createMock(AirportReconciliationService::class);
		$this->controller = new AirportApiController(
			'flightjournal',
			$this->createMock(IRequest::class),
			$this->airports,
			$this->createMock(FlightMapper::class),
			$this->createMock(IUserSession::class),
			$this->reconciler,
		);
	}

	public function testResolveReportsTheCanonicalCodeAndReferenceName(): void {
		$this->reconciler->method('resolve')->with('heathrow')
			->willReturn(new AirportMatch('LHR', 'London Heathrow', 51.47, -0.45));
		$this->airports->expects($this->never())->method('count');

		$this->assertSame(
			['match' => ['code' => 'LHR', 'name' => 'London Heathrow'], 'referenceLoaded' => true],
			$this->controller->resolve('heathrow')->getData(),
		);
	}

	public function testResolveReportsAMissWhenReferenceDataIsLoaded(): void {
		$this->reconciler->method('resolve')->willReturn(null);
		$this->airports->method('count')->willReturn(29000);

		$this->assertSame(
			['match' => null, 'referenceLoaded' => true],
			$this->controller->resolve('Dublin')->getData(),
		);
	}

	public function testResolveReportsAnEmptyReferenceTable(): void {
		$this->reconciler->method('resolve')->willReturn(null);
		$this->airports->method('count')->willReturn(0);

		$this->assertSame(
			['match' => null, 'referenceLoaded' => false],
			$this->controller->resolve('LHR')->getData(),
		);
	}
}
