<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Controller;

use OCA\FlightJournal\Service\FlightService;
use OCA\FlightJournal\Service\NotFoundException;
use OCA\FlightJournal\Service\ValidationException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * @psalm-import-type FlightJournalFlight from \OCA\FlightJournal\ResponseDefinitions
 *
 * @psalm-suppress UnusedClass
 */
class FlightApiController extends OCSController {
	public function __construct(
		string $appName,
		IRequest $request,
		private FlightService $service,
		private IUserSession $userSession,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * List the current user's flights, ordered by date descending
	 *
	 * @return DataResponse<Http::STATUS_OK, list<FlightJournalFlight>, array{}>
	 *
	 * 200: Flights returned
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/flights')]
	public function index(): DataResponse {
		$flights = $this->service->findAll($this->getUserId());
		return new DataResponse(array_values(array_map(fn ($f) => $f->jsonSerialize(), $flights)));
	}

	/**
	 * Fetch a single flight by id
	 *
	 * @param int $id Flight id
	 * @return DataResponse<Http::STATUS_OK, FlightJournalFlight, array{}>|DataResponse<Http::STATUS_NOT_FOUND, array{message: string}, array{}>
	 *
	 * 200: Flight returned
	 * 404: Flight not found
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/flights/{id}')]
	public function show(int $id): DataResponse {
		try {
			return new DataResponse($this->service->find($id, $this->getUserId())->jsonSerialize());
		} catch (NotFoundException $e) {
			return new DataResponse(['message' => $e->getMessage()], Http::STATUS_NOT_FOUND);
		}
	}

	/**
	 * Create a new flight for the current user
	 *
	 * @param string $flightDate Departure date in YYYY-MM-DD
	 * @param ?string $originCode IATA/ICAO origin code
	 * @param ?string $destinationCode IATA/ICAO destination code
	 * @param ?string $originLabel Free-text origin (when no code applies)
	 * @param ?string $destinationLabel Free-text destination (when no code applies)
	 * @param ?string $airlineCode IATA airline code
	 * @param ?string $flightNumber Numeric portion of the flight number
	 * @param ?string $aircraftTypeCode Canonical ICAO aircraft type code
	 * @param ?string $aircraftTypeRaw Verbatim aircraft type as entered
	 * @param ?string $registration Aircraft registration
	 * @param ?string $cabinClass Cabin class (economy|premium_economy|business|first|other)
	 * @param ?string $seat Seat number
	 * @param ?string $notes Free-text notes
	 * @return DataResponse<Http::STATUS_CREATED, FlightJournalFlight, array{}>|DataResponse<Http::STATUS_BAD_REQUEST, array{message: string}, array{}>
	 *
	 * 201: Flight created
	 * 400: Validation failed
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/flights')]
	public function create(
		string $flightDate,
		?string $originCode = null,
		?string $destinationCode = null,
		?string $originLabel = null,
		?string $destinationLabel = null,
		?string $airlineCode = null,
		?string $flightNumber = null,
		?string $aircraftTypeCode = null,
		?string $aircraftTypeRaw = null,
		?string $registration = null,
		?string $cabinClass = null,
		?string $seat = null,
		?string $notes = null,
	): DataResponse {
		try {
			$flight = $this->service->create($this->getUserId(), compact(
				'flightDate', 'originCode', 'destinationCode', 'originLabel', 'destinationLabel',
				'airlineCode', 'flightNumber', 'aircraftTypeCode', 'aircraftTypeRaw',
				'registration', 'cabinClass', 'seat', 'notes',
			));
			return new DataResponse($flight->jsonSerialize(), Http::STATUS_CREATED);
		} catch (ValidationException $e) {
			return new DataResponse(['message' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		}
	}

	/**
	 * Update an existing flight
	 *
	 * @param int $id Flight id
	 * @param string $flightDate Departure date in YYYY-MM-DD
	 * @param ?string $originCode IATA/ICAO origin code
	 * @param ?string $destinationCode IATA/ICAO destination code
	 * @param ?string $originLabel Free-text origin (when no code applies)
	 * @param ?string $destinationLabel Free-text destination (when no code applies)
	 * @param ?string $airlineCode IATA airline code
	 * @param ?string $flightNumber Numeric portion of the flight number
	 * @param ?string $aircraftTypeCode Canonical ICAO aircraft type code
	 * @param ?string $aircraftTypeRaw Verbatim aircraft type as entered
	 * @param ?string $registration Aircraft registration
	 * @param ?string $cabinClass Cabin class (economy|premium_economy|business|first|other)
	 * @param ?string $seat Seat number
	 * @param ?string $notes Free-text notes
	 * @return DataResponse<Http::STATUS_OK, FlightJournalFlight, array{}>|DataResponse<Http::STATUS_NOT_FOUND, array{message: string}, array{}>|DataResponse<Http::STATUS_BAD_REQUEST, array{message: string}, array{}>
	 *
	 * 200: Flight updated
	 * 400: Validation failed
	 * 404: Flight not found
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/flights/{id}')]
	public function update(
		int $id,
		string $flightDate,
		?string $originCode = null,
		?string $destinationCode = null,
		?string $originLabel = null,
		?string $destinationLabel = null,
		?string $airlineCode = null,
		?string $flightNumber = null,
		?string $aircraftTypeCode = null,
		?string $aircraftTypeRaw = null,
		?string $registration = null,
		?string $cabinClass = null,
		?string $seat = null,
		?string $notes = null,
	): DataResponse {
		try {
			$flight = $this->service->update($id, $this->getUserId(), compact(
				'flightDate', 'originCode', 'destinationCode', 'originLabel', 'destinationLabel',
				'airlineCode', 'flightNumber', 'aircraftTypeCode', 'aircraftTypeRaw',
				'registration', 'cabinClass', 'seat', 'notes',
			));
			return new DataResponse($flight->jsonSerialize());
		} catch (NotFoundException $e) {
			return new DataResponse(['message' => $e->getMessage()], Http::STATUS_NOT_FOUND);
		} catch (ValidationException $e) {
			return new DataResponse(['message' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		}
	}

	/**
	 * Delete a flight
	 *
	 * @param int $id Flight id
	 * @return DataResponse<Http::STATUS_OK, array{success: true}, array{}>|DataResponse<Http::STATUS_NOT_FOUND, array{message: string}, array{}>
	 *
	 * 200: Flight deleted
	 * 404: Flight not found
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/flights/{id}')]
	public function destroy(int $id): DataResponse {
		try {
			$this->service->delete($id, $this->getUserId());
			return new DataResponse(['success' => true]);
		} catch (NotFoundException $e) {
			return new DataResponse(['message' => $e->getMessage()], Http::STATUS_NOT_FOUND);
		}
	}

	private function getUserId(): string {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new \RuntimeException('No user in session');
		}
		return $user->getUID();
	}
}
