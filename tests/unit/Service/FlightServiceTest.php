<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Service;

use OCA\FlightJournal\Db\Flight;
use OCA\FlightJournal\Db\FlightMapper;
use OCA\FlightJournal\Service\AirportMatch;
use OCA\FlightJournal\Service\AirportReconciliationService;
use OCA\FlightJournal\Service\FlightService;
use OCA\FlightJournal\Service\NotFoundException;
use OCA\FlightJournal\Service\ValidationException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

class FlightServiceTest extends TestCase {
	private FlightMapper&MockObject $mapper;
	private ITimeFactory&MockObject $time;
	private AirportReconciliationService&MockObject $reconciler;
	private FlightService $service;

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = $this->createMock(FlightMapper::class);
		$this->time = $this->createMock(ITimeFactory::class);
		$this->time->method('getTime')->willReturn(1700000000);
		$this->reconciler = $this->createMock(AirportReconciliationService::class);
		$this->service = new FlightService($this->mapper, $this->time, $this->reconciler);
	}

	private function validData(array $overrides = []): array {
		return array_merge([
			'flightDate' => '2026-05-01',
			'originLabel' => 'Copenhagen',
			'destinationLabel' => 'London',
		], $overrides);
	}

	public function testFindAllDelegatesToMapper(): void {
		$flights = [new Flight(), new Flight()];
		$this->mapper->expects($this->once())
			->method('findAllForUser')
			->with('alice')
			->willReturn($flights);
		$this->assertSame($flights, $this->service->findAll('alice'));
	}

	public function testFindReturnsFlight(): void {
		$flight = new Flight();
		$this->mapper->method('findForUser')->with(7, 'alice')->willReturn($flight);
		$this->assertSame($flight, $this->service->find(7, 'alice'));
	}

	public function testFindThrowsNotFoundWhenMissing(): void {
		$this->mapper->method('findForUser')->willThrowException(new DoesNotExistException('nope'));
		$this->expectException(NotFoundException::class);
		$this->service->find(7, 'alice');
	}

	public function testCreatePersistsValidFlight(): void {
		$captured = null;
		$this->mapper->expects($this->once())
			->method('insert')
			->willReturnCallback(function (Flight $f) use (&$captured) {
				$captured = $f;
				return $f;
			});

		$result = $this->service->create('alice', $this->validData([
			'originCode' => 'cph',
			'destinationCode' => 'lhr',
			'airlineCode' => 'sk',
			'aircraftTypeCode' => 'b738',
			'cabinClass' => 'economy',
		]));

		$this->assertSame($captured, $result);
		$this->assertSame('alice', $captured->getUserId());
		$this->assertSame('2026-05-01', $captured->getFlightDate());
		// Codes are uppercased.
		$this->assertSame('CPH', $captured->getOriginCode());
		$this->assertSame('LHR', $captured->getDestinationCode());
		$this->assertSame('SK', $captured->getAirlineCode());
		$this->assertSame('B738', $captured->getAircraftTypeCode());
		// Labels preserved as-is.
		$this->assertSame('Copenhagen', $captured->getOriginLabel());
		$this->assertSame('London', $captured->getDestinationLabel());
		// Timestamps set from ITimeFactory.
		$this->assertSame(1700000000, $captured->getCreatedAt());
		$this->assertSame(1700000000, $captured->getUpdatedAt());
	}

	public function testCreateTrimsWhitespaceAndTreatsBlanksAsNull(): void {
		$captured = null;
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});

		$this->service->create('alice', $this->validData([
			'notes' => '  hello  ',
			'seat' => '   ',
		]));

		$this->assertSame('hello', $captured->getNotes());
		$this->assertNull($captured->getSeat());
	}

	public function testCreateRequiresFlightDate(): void {
		$this->expectException(ValidationException::class);
		$this->service->create('alice', [
			'originLabel' => 'A',
			'destinationLabel' => 'B',
		]);
	}

	public function testCreateRejectsBadDateFormat(): void {
		$this->expectException(ValidationException::class);
		$this->expectExceptionMessage('YYYY-MM-DD');
		$this->service->create('alice', $this->validData(['flightDate' => '2026/05/01']));
	}

	public function testCreateRequiresOrigin(): void {
		$this->expectException(ValidationException::class);
		$this->expectExceptionMessage('Origin');
		$this->service->create('alice', [
			'flightDate' => '2026-05-01',
			'destinationLabel' => 'B',
		]);
	}

	public function testCreateRequiresDestination(): void {
		$this->expectException(ValidationException::class);
		$this->expectExceptionMessage('Destination');
		$this->service->create('alice', [
			'flightDate' => '2026-05-01',
			'originLabel' => 'A',
		]);
	}

	public function testOriginCanBeSatisfiedByCode(): void {
		$this->mapper->method('insert')->willReturnArgument(0);
		$flight = $this->service->create('alice', [
			'flightDate' => '2026-05-01',
			'originCode' => 'cph',
			'destinationCode' => 'lhr',
		]);
		$this->assertSame('CPH', $flight->getOriginCode());
		$this->assertNull($flight->getOriginLabel());
	}

	public function testCreateRejectsInvalidCabinClass(): void {
		$this->expectException(ValidationException::class);
		$this->expectExceptionMessage('cabinClass');
		$this->service->create('alice', $this->validData(['cabinClass' => 'platinum']));
	}

	public function testCreateAcceptsAllAllowedCabinClasses(): void {
		$this->mapper->method('insert')->willReturnArgument(0);
		foreach (['economy', 'premium_economy', 'business', 'first', 'other'] as $cabin) {
			$flight = $this->service->create('alice', $this->validData(['cabinClass' => $cabin]));
			$this->assertSame($cabin, $flight->getCabinClass());
		}
	}

	public function testUpdateModifiesExistingFlight(): void {
		$existing = new Flight();
		$existing->setUserId('alice');
		$existing->setFlightDate('2026-01-01');
		$existing->setCreatedAt(1600000000);
		$existing->setUpdatedAt(1600000000);

		$this->mapper->method('findForUser')->with(7, 'alice')->willReturn($existing);
		$this->mapper->expects($this->once())
			->method('update')
			->willReturnCallback(fn (Flight $f) => $f);

		$result = $this->service->update(7, 'alice', $this->validData(['notes' => 'updated']));

		$this->assertSame($existing, $result);
		$this->assertSame('alice', $result->getUserId());
		$this->assertSame('2026-05-01', $result->getFlightDate());
		$this->assertSame('updated', $result->getNotes());
		$this->assertSame(1600000000, $result->getCreatedAt(), 'createdAt preserved');
		$this->assertSame(1700000000, $result->getUpdatedAt(), 'updatedAt refreshed');
	}

	public function testUpdatePreservesUnchangedEndpointWithUnresolvableLabel(): void {
		// Regression for the demo-data bug: a flight imported with a code and a
		// human label ("Dublin") that does not itself resolve. Editing an
		// unrelated field (the seat) must not re-reconcile the unchanged label and
		// clear the code/distance.
		$existing = new Flight();
		$existing->setUserId('alice');
		$existing->setFlightDate('2026-02-16');
		$existing->setOriginLabel('Dublin');
		$existing->setOriginCode('DUB');
		$existing->setDestinationLabel('Frankfurt am Main');
		$existing->setDestinationCode('FRA');
		$existing->setDistanceKm(1086);
		$existing->setSeat('15A');

		$this->mapper->method('findForUser')->with(7, 'alice')->willReturn($existing);
		$this->mapper->method('update')->willReturnArgument(0);

		// The human labels don't resolve (as in the real reference data, where
		// "Dublin" is ambiguous by city); only the canonical codes do.
		$this->reconciler->method('resolve')->willReturnMap([
			['Dublin', null],
			['Frankfurt am Main', null],
			['DUB', new AirportMatch('DUB', 'Dublin', 53.42, -6.27)],
			['FRA', new AirportMatch('FRA', 'Frankfurt am Main', 50.03, 8.57)],
		]);

		$result = $this->service->update(7, 'alice', [
			'flightDate' => '2026-02-16',
			'originLabel' => 'Dublin',
			'destinationLabel' => 'Frankfurt am Main',
			'seat' => '15C', // the only change
		]);

		$this->assertSame('DUB', $result->getOriginCode(), 'unchanged origin keeps its code');
		$this->assertSame('FRA', $result->getDestinationCode(), 'unchanged destination keeps its code');
		$this->assertSame('Dublin', $result->getOriginLabel(), 'origin label untouched');
		$this->assertSame('Frankfurt am Main', $result->getDestinationLabel(), 'destination label untouched');
		$this->assertSame(1086, $result->getDistanceKm(), 'distance retained when both endpoints unchanged');
		$this->assertSame('15C', $result->getSeat(), 'the edited field is applied');
	}

	public function testUpdateReReconcilesAnEditedEndpointLabel(): void {
		// The flip side: when the user *does* change an endpoint label, it is
		// reconciled afresh (and the other, unchanged side is still preserved).
		$existing = new Flight();
		$existing->setUserId('alice');
		$existing->setFlightDate('2026-02-16');
		$existing->setOriginLabel('Dublin');
		$existing->setOriginCode('DUB');
		$existing->setDestinationLabel('Frankfurt am Main');
		$existing->setDestinationCode('FRA');
		$existing->setDistanceKm(1086);

		$this->mapper->method('findForUser')->with(7, 'alice')->willReturn($existing);
		$this->mapper->method('update')->willReturnArgument(0);

		$this->reconciler->method('resolve')->willReturnMap([
			['LHR', new AirportMatch('LHR', 'London Heathrow', 51.47, -0.4543)],
			['FRA', new AirportMatch('FRA', 'Frankfurt am Main', 50.03, 8.57)],
		]);

		// Origin changed Dublin → LHR; destination label left unchanged.
		$result = $this->service->update(7, 'alice', [
			'flightDate' => '2026-02-16',
			'originLabel' => 'LHR',
			'destinationLabel' => 'Frankfurt am Main',
		]);

		$this->assertSame('LHR', $result->getOriginCode(), 'edited origin re-reconciled');
		$this->assertSame('London Heathrow', $result->getOriginLabel(), 'label replaced with the reference name');
		$this->assertSame('FRA', $result->getDestinationCode(), 'unchanged destination still kept');
		$this->assertNotNull($result->getDistanceKm(), 'distance recomputed for the new route');
		$this->assertNotSame(1086, $result->getDistanceKm(), 'distance reflects LHR→FRA, not the old route');
	}

	public function testCreateAppendsToEndOfDay(): void {
		$captured = null;
		$this->mapper->method('maxDaySeqForDate')->with('alice', '2026-05-01')->willReturn(2);
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});

		$this->service->create('alice', $this->validData());

		$this->assertSame(3, $captured->getDaySeq(), 'next leg appended after the existing two');
	}

	public function testCreateFirstLegOfDayGetsSeqOne(): void {
		$captured = null;
		// Default mock return for maxDaySeqForDate is 0 (no flights that day yet).
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});

		$this->service->create('alice', $this->validData());

		$this->assertSame(1, $captured->getDaySeq());
	}

	public function testUpdateReappendsWhenDateChanges(): void {
		$existing = new Flight();
		$existing->setUserId('alice');
		$existing->setFlightDate('2026-01-01');
		$existing->setDaySeq(1);

		$this->mapper->method('findForUser')->with(7, 'alice')->willReturn($existing);
		$this->mapper->method('update')->willReturnArgument(0);
		$this->mapper->expects($this->once())
			->method('maxDaySeqForDate')
			->with('alice', '2026-05-01')
			->willReturn(4);

		$result = $this->service->update(7, 'alice', $this->validData());

		$this->assertSame(5, $result->getDaySeq(), 're-dated leg appended to the new day');
	}

	public function testUpdateKeepsDaySeqWhenDateUnchanged(): void {
		$existing = new Flight();
		$existing->setUserId('alice');
		$existing->setFlightDate('2026-05-01');
		$existing->setDaySeq(3);

		$this->mapper->method('findForUser')->with(7, 'alice')->willReturn($existing);
		$this->mapper->method('update')->willReturnArgument(0);
		$this->mapper->expects($this->never())->method('maxDaySeqForDate');

		$result = $this->service->update(7, 'alice', $this->validData(['notes' => 'same day edit']));

		$this->assertSame(3, $result->getDaySeq(), 'editing other fields leaves order untouched');
	}

	public function testMoveSwapsDaySeqWithNeighbor(): void {
		$flight = new Flight();
		$flight->setUserId('alice');
		$flight->setFlightDate('2026-05-01');
		$flight->setDaySeq(2);

		$neighbor = new Flight();
		$neighbor->setUserId('alice');
		$neighbor->setFlightDate('2026-05-01');
		$neighbor->setDaySeq(1);

		$this->mapper->method('findForUser')->with(7, 'alice')->willReturn($flight);
		$this->mapper->method('findSwapNeighbor')->with($flight, 'earlier')->willReturn($neighbor);
		$this->mapper->expects($this->exactly(2))->method('update')->willReturnArgument(0);

		$result = $this->service->move(7, 'alice', 'earlier');

		$this->assertSame(1, $result->getDaySeq(), 'moved flight takes the neighbor seq');
		$this->assertSame(2, $neighbor->getDaySeq(), 'neighbor takes the moved flight seq');
	}

	public function testMoveIsNoOpAtEdgeOfDay(): void {
		$flight = new Flight();
		$flight->setUserId('alice');
		$flight->setFlightDate('2026-05-01');
		$flight->setDaySeq(1);

		$this->mapper->method('findForUser')->with(7, 'alice')->willReturn($flight);
		$this->mapper->method('findSwapNeighbor')->with($flight, 'earlier')->willReturn(null);
		$this->mapper->expects($this->never())->method('update');

		$result = $this->service->move(7, 'alice', 'earlier');

		$this->assertSame(1, $result->getDaySeq(), 'order unchanged when already first');
	}

	public function testMoveRejectsBadDirection(): void {
		$this->mapper->expects($this->never())->method('findForUser');
		$this->expectException(ValidationException::class);
		$this->service->move(7, 'alice', 'sideways');
	}

	public function testUpdateThrowsNotFoundForOtherUser(): void {
		$this->mapper->method('findForUser')->willThrowException(new DoesNotExistException('nope'));
		$this->expectException(NotFoundException::class);
		$this->service->update(7, 'mallory', $this->validData());
	}

	public function testUpdateValidatesBeforeWriting(): void {
		$this->mapper->method('findForUser')->willReturn(new Flight());
		$this->mapper->expects($this->never())->method('update');
		$this->expectException(ValidationException::class);
		$this->service->update(7, 'alice', ['flightDate' => 'bad']);
	}

	public function testDeleteLooksUpThenDeletes(): void {
		$flight = new Flight();
		$this->mapper->method('findForUser')->with(7, 'alice')->willReturn($flight);
		$this->mapper->expects($this->once())->method('delete')->with($flight);
		$this->service->delete(7, 'alice');
	}

	public function testDeleteThrowsNotFoundForOtherUser(): void {
		$this->mapper->method('findForUser')->willThrowException(new DoesNotExistException('nope'));
		$this->mapper->expects($this->never())->method('delete');
		$this->expectException(NotFoundException::class);
		$this->service->delete(7, 'mallory');
	}

	public function testDeleteAllReturnsCount(): void {
		$this->mapper->expects($this->once())
			->method('deleteAllForUser')
			->with('alice')
			->willReturn(42);
		$this->assertSame(42, $this->service->deleteAll('alice'));
	}

	public function testCreateResolvesLabelsToCodesAndRewritesLabels(): void {
		$captured = null;
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});
		$this->reconciler->method('resolve')->willReturnMap([
			['Copenhagen', new AirportMatch('CPH', 'Copenhagen Kastrup')],
			['London', new AirportMatch('LHR', 'London Heathrow')],
		]);

		$this->service->create('alice', $this->validData());

		$this->assertSame('CPH', $captured->getOriginCode());
		$this->assertSame('LHR', $captured->getDestinationCode());
		// On a match the label is replaced with the reference airport name.
		$this->assertSame('Copenhagen Kastrup', $captured->getOriginLabel());
		$this->assertSame('London Heathrow', $captured->getDestinationLabel());
	}

	public function testCreateKeepsLabelWhenMatchHasNoName(): void {
		$captured = null;
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});
		$this->reconciler->method('resolve')->willReturn(new AirportMatch('XXX', null));

		$this->service->create('alice', $this->validData());

		$this->assertSame('XXX', $captured->getOriginCode());
		$this->assertSame('Copenhagen', $captured->getOriginLabel(), 'label kept when match has no name');
	}

	public function testCreateLeavesCodeNullWhenLabelUnresolved(): void {
		$captured = null;
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});
		$this->reconciler->method('resolve')->willReturn(null);

		$this->service->create('alice', $this->validData());

		$this->assertNull($captured->getOriginCode());
		$this->assertNull($captured->getDestinationCode());
	}

	public function testCreateComputesDistanceWhenBothEndpointsHaveCoords(): void {
		$captured = null;
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});
		$this->reconciler->method('resolve')->willReturnMap([
			['Copenhagen', new AirportMatch('CPH', 'Copenhagen Kastrup', 55.618, 12.656)],
			['London', new AirportMatch('LHR', 'London Heathrow', 51.47, -0.4543)],
		]);

		$this->service->create('alice', $this->validData());

		// CPH → LHR great circle is ~955 km.
		$this->assertEqualsWithDelta(955, $captured->getDistanceKm(), 30);
	}

	public function testCreateLeavesDistanceNullWhenAnEndpointUnresolved(): void {
		$captured = null;
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});
		$this->reconciler->method('resolve')->willReturnMap([
			['Copenhagen', new AirportMatch('CPH', 'Copenhagen Kastrup', 55.618, 12.656)],
			['London', null],
		]);

		$this->service->create('alice', $this->validData());

		$this->assertNull($captured->getDistanceKm());
	}

	public function testCreateLeavesDistanceNullWhenMatchHasNoCoords(): void {
		$captured = null;
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});
		// Matches without lat/lon (e.g. reference row lacks coords).
		$this->reconciler->method('resolve')->willReturnMap([
			['Copenhagen', new AirportMatch('CPH', 'Copenhagen Kastrup')],
			['London', new AirportMatch('LHR', 'London Heathrow')],
		]);

		$this->service->create('alice', $this->validData());

		$this->assertNull($captured->getDistanceKm());
	}

	public function testRestorePreservesDaySeqDistanceAndTimestamps(): void {
		$captured = null;
		$this->mapper->expects($this->never())->method('maxDaySeqForDate');
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});

		$this->service->restore('alice', $this->validData([
			'originCode' => 'CPH',
			'destinationCode' => 'LHR',
			'daySeq' => 3,
			'distanceKm' => 955,
			'createdAt' => 1600000000,
			'updatedAt' => 1600000500,
		]));

		$this->assertSame(3, $captured->getDaySeq(), 'explicit day_seq honoured');
		$this->assertSame(955, $captured->getDistanceKm(), 'recorded distance honoured');
		$this->assertSame(1600000000, $captured->getCreatedAt(), 'createdAt honoured');
		$this->assertSame(1600000500, $captured->getUpdatedAt(), 'updatedAt honoured');
	}

	public function testRestoreDerivesDaySeqAndTimestampsWhenAbsent(): void {
		$captured = null;
		$this->mapper->method('maxDaySeqForDate')->with('alice', '2026-05-01')->willReturn(1);
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});

		// Bare row: no day_seq/distance/timestamps.
		$this->service->restore('alice', $this->validData([
			'originCode' => 'CPH',
			'destinationCode' => 'LHR',
		]));

		$this->assertSame(2, $captured->getDaySeq(), 'appended to end of day when absent');
		$this->assertSame(1700000000, $captured->getCreatedAt(), 'timestamps fall back to now');
		$this->assertSame(1700000000, $captured->getUpdatedAt());
	}

	public function testRestoreReconcilesAndKeepsComputedDistanceWhenBackupHasNone(): void {
		$captured = null;
		$this->mapper->method('insert')->willReturnCallback(function (Flight $f) use (&$captured) {
			$captured = $f;
			return $f;
		});
		// A backup row whose endpoints were never matched (no codes, no distance):
		// reconciliation runs and may now resolve + compute distance.
		$this->reconciler->method('resolve')->willReturnMap([
			['Copenhagen', new AirportMatch('CPH', 'Copenhagen Kastrup', 55.618, 12.656)],
			['London', new AirportMatch('LHR', 'London Heathrow', 51.47, -0.4543)],
		]);

		$this->service->restore('alice', $this->validData());

		$this->assertSame('CPH', $captured->getOriginCode());
		$this->assertEqualsWithDelta(955, $captured->getDistanceKm(), 30, 'distance reconciled when backup omits it');
	}

	public function testRestoreValidatesLikeCreate(): void {
		$this->mapper->expects($this->never())->method('insert');
		$this->expectException(ValidationException::class);
		$this->service->restore('alice', ['flightDate' => 'bad']);
	}

	public function testReconcileAllRecomputesDistanceWhenBothSidesResolve(): void {
		$flight = new Flight();
		$flight->setOriginLabel('Copenhagen');
		$flight->setDestinationLabel('London');

		$this->mapper->method('findAllForUser')->willReturn([$flight]);
		$this->reconciler->method('resolve')->willReturnMap([
			['Copenhagen', new AirportMatch('CPH', 'Copenhagen Kastrup', 55.618, 12.656)],
			['London', new AirportMatch('LHR', 'London Heathrow', 51.47, -0.4543)],
		]);
		$this->mapper->expects($this->once())->method('update')->willReturnArgument(0);

		$result = $this->service->reconcileAll('alice', false);

		$this->assertSame(1, $result['updated']);
		$this->assertEqualsWithDelta(955, $flight->getDistanceKm(), 30);
	}

	public function testReconcileAllOnlyMissingLeavesDistanceUntouchedForSkippedSide(): void {
		// Origin already coded → skipped under onlyMissing, so distance can't be
		// recomputed (only one side resolved); the existing value is preserved.
		$flight = new Flight();
		$flight->setOriginLabel('Copenhagen');
		$flight->setOriginCode('CPH');
		$flight->setDestinationLabel('Nowhere');
		$flight->setDistanceKm(1234);

		$this->mapper->method('findAllForUser')->willReturn([$flight]);
		$this->reconciler->method('resolve')->willReturnMap([
			['Nowhere', null],
		]);
		$this->mapper->expects($this->never())->method('update');

		$this->service->reconcileAll('alice', true);

		$this->assertSame(1234, $flight->getDistanceKm());
	}

	public function testReconcileAllOnlyMissingSkipsFlightsWithCode(): void {
		$withCode = new Flight();
		$withCode->setOriginLabel('Copenhagen');
		$withCode->setOriginCode('CPH');
		$withCode->setDestinationLabel('London');
		$withCode->setDestinationCode('LHR');

		$missing = new Flight();
		$missing->setOriginLabel('Copenhagen');
		$missing->setDestinationLabel('Nowhere');

		$this->mapper->method('findAllForUser')->willReturn([$withCode, $missing]);
		$this->reconciler->method('resolve')->willReturnMap([
			['Copenhagen', new AirportMatch('CPH', 'Copenhagen Kastrup')],
			['Nowhere', null],
		]);
		$this->mapper->expects($this->once())->method('update');

		$result = $this->service->reconcileAll('alice', true);

		$this->assertSame(2, $result['flights']);
		$this->assertSame(1, $result['updated']);
		$this->assertSame(1, $result['matched']);
		$this->assertSame(1, $result['unmatched']);
		$this->assertSame('CPH', $missing->getOriginCode());
		$this->assertSame('Copenhagen Kastrup', $missing->getOriginLabel(), 'recheck rewrites the label too');
		// The flight that already had codes was skipped entirely.
		$this->assertSame('London', $withCode->getDestinationLabel());
	}

	public function testReconcileAllScopeAllRefreshesFromCodeNotLabel(): void {
		// The demo-data scenario: a flight has valid codes but human labels that
		// don't themselves resolve ("Dublin"). A full recheck must refresh from
		// the code (and may tidy the label) — never clear the code because the
		// label failed to resolve.
		$flight = new Flight();
		$flight->setOriginLabel('Dublin');
		$flight->setOriginCode('DUB');
		$flight->setDestinationLabel('Frankfurt am Main');
		$flight->setDestinationCode('FRA');
		$flight->setDistanceKm(1086);

		$this->mapper->method('findAllForUser')->willReturn([$flight]);
		$this->mapper->method('update')->willReturnArgument(0);
		// Resolving the labels fails; resolving the codes succeeds.
		$this->reconciler->method('resolve')->willReturnMap([
			['Dublin', null],
			['Frankfurt am Main', null],
			['DUB', new AirportMatch('DUB', 'Dublin Airport', 53.4213, -6.2701)],
			['FRA', new AirportMatch('FRA', 'Frankfurt am Main International Airport', 50.0264, 8.5431)],
		]);

		$result = $this->service->reconcileAll('alice', false);

		$this->assertSame('DUB', $flight->getOriginCode(), 'code preserved, not cleared');
		$this->assertSame('FRA', $flight->getDestinationCode(), 'code preserved, not cleared');
		$this->assertSame('Dublin Airport', $flight->getOriginLabel(), 'label refreshed to reference name');
		$this->assertSame('Frankfurt am Main International Airport', $flight->getDestinationLabel());
		$this->assertNotNull($flight->getDistanceKm(), 'distance recomputed from reference coords');
		$this->assertSame(2, $result['matched']);
		$this->assertSame(0, $result['unmatched']);
	}

	public function testReconcileAllScopeAllPreservesCodesWhenNoReferenceData(): void {
		// On an instance with no reference data loaded, every code lookup returns
		// null. A full recheck must leave fully-coded flights completely untouched
		// rather than wiping their codes and distance.
		$flight = new Flight();
		$flight->setOriginLabel('Dublin');
		$flight->setOriginCode('DUB');
		$flight->setDestinationLabel('Frankfurt am Main');
		$flight->setDestinationCode('FRA');
		$flight->setDistanceKm(1086);

		$this->mapper->method('findAllForUser')->willReturn([$flight]);
		$this->reconciler->method('resolve')->willReturn(null);
		$this->mapper->expects($this->never())->method('update');

		$result = $this->service->reconcileAll('alice', false);

		$this->assertSame('DUB', $flight->getOriginCode());
		$this->assertSame('FRA', $flight->getDestinationCode());
		$this->assertSame('Dublin', $flight->getOriginLabel());
		$this->assertSame(1086, $flight->getDistanceKm(), 'distance untouched');
		$this->assertSame(0, $result['updated']);
	}

	public function testReconcileAllScopeAllCanonicalisesIcaoToIata(): void {
		// A code-present refresh resolves the stored code and adopts the canonical
		// code from the reference (IATA preferred over ICAO).
		$flight = new Flight();
		$flight->setOriginLabel('Dublin Airport');
		$flight->setOriginCode('EIDW');
		$flight->setDestinationLabel('Frankfurt am Main International Airport');
		$flight->setDestinationCode('FRA');

		$this->mapper->method('findAllForUser')->willReturn([$flight]);
		$this->mapper->method('update')->willReturnArgument(0);
		$this->reconciler->method('resolve')->willReturnMap([
			['EIDW', new AirportMatch('DUB', 'Dublin Airport', 53.4213, -6.2701)],
			['FRA', new AirportMatch('FRA', 'Frankfurt am Main International Airport', 50.0264, 8.5431)],
		]);

		$result = $this->service->reconcileAll('alice', false);

		$this->assertSame('DUB', $flight->getOriginCode(), 'ICAO code canonicalised to IATA');
		$this->assertSame(1, $result['updated']);
	}
}
