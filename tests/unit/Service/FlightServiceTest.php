<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Service;

use OCA\FlightJournal\Db\Flight;
use OCA\FlightJournal\Db\FlightMapper;
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
	private FlightService $service;

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = $this->createMock(FlightMapper::class);
		$this->time = $this->createMock(ITimeFactory::class);
		$this->time->method('getTime')->willReturn(1700000000);
		$this->service = new FlightService($this->mapper, $this->time);
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
}
