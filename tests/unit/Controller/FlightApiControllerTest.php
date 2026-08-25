<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Controller;

use OCA\FlightJournal\Controller\FlightApiController;
use OCA\FlightJournal\Db\Flight;
use OCA\FlightJournal\Service\FlightService;
use OCP\AppFramework\Http;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * The controller declares its inputs as an explicit typed parameter list and
 * hands them to the service via compact(). That is easy to extend wrongly: a
 * field added to the entity, the service and the client but *not* to this list
 * is silently dropped, and the save looks like it worked.
 *
 * That is exactly how aircraftManufacturer/aircraftModel went missing, so these
 * tests assert the whole payload reaches the service rather than spot-checking.
 */
class FlightApiControllerTest extends TestCase {
	private FlightService&MockObject $service;
	private FlightApiController $controller;

	protected function setUp(): void {
		parent::setUp();
		$this->service = $this->createMock(FlightService::class);

		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('alice');
		$session = $this->createMock(IUserSession::class);
		$session->method('getUser')->willReturn($user);

		$this->controller = new FlightApiController(
			'flightjournal',
			$this->createMock(IRequest::class),
			$this->service,
			$session,
		);
	}

	/**
	 * Every field the client may send, so a newly added one that the controller
	 * forgets to declare shows up as a missing key here.
	 *
	 * @return array<string, string>
	 */
	private static function fullPayload(): array {
		return [
			'flightDate' => '2026-05-01',
			'originCode' => 'CPH',
			'destinationCode' => 'LHR',
			'originLabel' => 'Copenhagen',
			'destinationLabel' => 'London',
			'airlineCode' => 'SK',
			'flightNumber' => '1234',
			'aircraftTypeCode' => 'B738',
			'aircraftTypeRaw' => '738',
			'aircraftManufacturer' => 'BOEING',
			'aircraftModel' => '737-800',
			'registration' => 'OY-KAL',
			'cabinClass' => 'economy',
			'seat' => '14C',
			'notes' => 'window',
		];
	}

	public function testCreateForwardsEveryFieldToTheService(): void {
		$payload = self::fullPayload();
		$this->service->expects($this->once())
			->method('create')
			->with('alice', $payload)
			->willReturn(new Flight());

		$response = $this->controller->create(...$payload);

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
	}

	public function testUpdateForwardsEveryFieldToTheService(): void {
		$payload = self::fullPayload();
		$this->service->expects($this->once())
			->method('update')
			->with(7, 'alice', $payload)
			->willReturn(new Flight());

		$this->controller->update(7, ...$payload);
	}

	/**
	 * The regression that prompted these tests: picking a model in the editor
	 * sends these three together, and dropping any of them makes the save look
	 * successful while silently discarding the choice.
	 */
	public function testUpdateCarriesAnExplicitlyChosenAircraftType(): void {
		$this->service->expects($this->once())
			->method('update')
			->with(7, 'alice', $this->callback(static function (array $data): bool {
				return ($data['aircraftTypeCode'] ?? null) === 'B738'
					&& ($data['aircraftManufacturer'] ?? null) === 'BOEING'
					&& ($data['aircraftModel'] ?? null) === '737-800'
					// The typed text must survive the pick untouched.
					&& ($data['aircraftTypeRaw'] ?? null) === 'the boeing';
			}))
			->willReturn(new Flight());

		$this->controller->update(
			7,
			'2026-05-01',
			originLabel: 'Copenhagen',
			destinationLabel: 'London',
			aircraftTypeCode: 'B738',
			aircraftTypeRaw: 'the boeing',
			aircraftManufacturer: 'BOEING',
			aircraftModel: '737-800',
		);
	}

	/**
	 * The free-text path: no pick means no code, so the service reconciles.
	 */
	public function testCreateSendsNullAircraftFieldsWhenNothingWasPicked(): void {
		$this->service->expects($this->once())
			->method('create')
			->with('alice', $this->callback(static function (array $data): bool {
				return array_key_exists('aircraftManufacturer', $data)
					&& $data['aircraftManufacturer'] === null
					&& $data['aircraftModel'] === null
					&& $data['aircraftTypeCode'] === null
					&& $data['aircraftTypeRaw'] === 'A320neo';
			}))
			->willReturn(new Flight());

		$this->controller->create(
			'2026-05-01',
			originLabel: 'Copenhagen',
			destinationLabel: 'London',
			aircraftTypeRaw: 'A320neo',
		);
	}
}
