<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Controller;

use OCA\FlightJournal\Db\AirportMapper;
use OCA\FlightJournal\Db\FlightMapper;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Read-only airport reference data for any logged-in user.
 *
 * @psalm-suppress UnusedClass
 */
class AirportApiController extends OCSController {
	private const DEFAULT_LIMIT = 100;
	private const MAX_LIMIT = 500;

	public function __construct(
		string $appName,
		IRequest $request,
		private AirportMapper $airports,
		private FlightMapper $flights,
		private IUserSession $userSession,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * Look up airports by a comma-separated list of IATA/ICAO codes.
	 *
	 * Used by the Map view to resolve coordinates for flown airports.
	 *
	 * @param string $codes Comma-separated IATA/ICAO codes
	 * @return DataResponse<Http::STATUS_OK, array{items: list<array{id: int, iata: ?string, icao: ?string, name: ?string, city: ?string, state: ?string, countryIso2: ?string, lat: ?float, lon: ?float, elevation: ?int, tz: ?string, source: ?string, updatedAt: int}>}, array{}>
	 *
	 * 200: Matching airports returned
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/airports/by-codes')]
	public function byCodes(string $codes = ''): DataResponse {
		$list = array_values(array_filter(
			array_map('trim', explode(',', $codes)),
			static fn (string $c) => $c !== '',
		));
		$items = array_values(array_map(
			static fn ($airport) => $airport->jsonSerialize(),
			$this->airports->findByCodes($list),
		));
		return new DataResponse(['items' => $items]);
	}

	/**
	 * List airports with optional search and pagination.
	 *
	 * @param string|null $q Optional search term matched against icao/iata/name/city
	 * @param int $limit Page size (1..500, default 100)
	 * @param int $offset Row offset (>= 0)
	 * @param bool $flownOnly When true, restrict to the user's flown airports
	 * @return DataResponse<Http::STATUS_OK, array{items: list<array{id: int, iata: ?string, icao: ?string, name: ?string, city: ?string, state: ?string, countryIso2: ?string, lat: ?float, lon: ?float, elevation: ?int, tz: ?string, source: ?string, updatedAt: int}>, total: int, limit: int, offset: int}, array{}>
	 *
	 * 200: Page of airports returned
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/airports')]
	public function list(?string $q = null, int $limit = self::DEFAULT_LIMIT, int $offset = 0, bool $flownOnly = true): DataResponse {
		$limit = max(1, min(self::MAX_LIMIT, $limit));
		$offset = max(0, $offset);
		$codes = null;
		if ($flownOnly) {
			$user = $this->userSession->getUser();
			$codes = $user === null ? [] : $this->flights->findFlownAirportCodes($user->getUID());
		}
		$items = array_values(array_map(
			static fn ($airport) => $airport->jsonSerialize(),
			$this->airports->search($q, $limit, $offset, $codes),
		));
		$total = $this->airports->countSearch($q, $codes);
		return new DataResponse([
			'items' => $items,
			'total' => $total,
			'limit' => $limit,
			'offset' => $offset,
		]);
	}
}
