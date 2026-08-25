<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Controller;

use OCA\FlightJournal\Db\AircraftTypeMapper;
use OCA\FlightJournal\Db\FlightMapper;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Read-only aircraft type reference data for any logged-in user, mirroring
 * AirportApiController.
 *
 * @psalm-suppress UnusedClass
 */
class AircraftTypeApiController extends OCSController {
	private const DEFAULT_LIMIT = 100;
	private const MAX_LIMIT = 500;

	public function __construct(
		string $appName,
		IRequest $request,
		private AircraftTypeMapper $types,
		private FlightMapper $flights,
		private IUserSession $userSession,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * List aircraft types with optional search and pagination.
	 *
	 * @param string|null $q Optional search term matched against designator/iata/manufacturer/model
	 * @param int $limit Page size (1..500, default 100)
	 * @param int $offset Row offset (>= 0)
	 * @param bool $flownOnly When true, restrict to designators the user has flown
	 * @return DataResponse<Http::STATUS_OK, array{items: list<array{id: int, icaoCode: string, iataCode: ?string, manufacturer: ?string, model: ?string, modelNormalized: ?string, engineType: ?string, engineCount: ?int, wtc: ?string, description: ?string, canonical: bool, source: ?string, updatedAt: int}>, total: int, limit: int, offset: int}, array{}>
	 *
	 * 200: Page of aircraft types returned
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/aircraft-types')]
	public function list(?string $q = null, int $limit = self::DEFAULT_LIMIT, int $offset = 0, bool $flownOnly = true): DataResponse {
		$limit = max(1, min(self::MAX_LIMIT, $limit));
		$offset = max(0, $offset);
		$designators = null;
		if ($flownOnly) {
			$user = $this->userSession->getUser();
			$designators = $user === null ? [] : $this->flights->findFlownAircraftCodes($user->getUID());
		}
		$items = array_values(array_map(
			static fn ($type) => $type->jsonSerialize(),
			$this->types->search($q, $limit, $offset, $designators),
		));
		$total = $this->types->countSearch($q, $designators);
		return new DataResponse([
			'items' => $items,
			'total' => $total,
			'limit' => $limit,
			'offset' => $offset,
		]);
	}
}
