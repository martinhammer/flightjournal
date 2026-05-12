<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Controller;

use OCA\FlightJournal\Db\AirportMapper;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

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
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * List airports with optional search and pagination.
	 *
	 * @param string|null $q Optional search term matched against icao/iata/name/city
	 * @param int $limit Page size (1..500, default 100)
	 * @param int $offset Row offset (>= 0)
	 * @return DataResponse<Http::STATUS_OK, array{items: list<array{id: int, iata: ?string, icao: ?string, name: ?string, city: ?string, state: ?string, countryIso2: ?string, lat: ?float, lon: ?float, elevation: ?int, tz: ?string, source: ?string, updatedAt: int}>, total: int, limit: int, offset: int}, array{}>
	 *
	 * 200: Page of airports returned
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/airports')]
	public function list(?string $q = null, int $limit = self::DEFAULT_LIMIT, int $offset = 0): DataResponse {
		$limit = max(1, min(self::MAX_LIMIT, $limit));
		$offset = max(0, $offset);
		$items = array_values(array_map(
			static fn ($airport) => $airport->jsonSerialize(),
			$this->airports->search($q, $limit, $offset),
		));
		$total = $this->airports->countSearch($q);
		return new DataResponse([
			'items' => $items,
			'total' => $total,
			'limit' => $limit,
			'offset' => $offset,
		]);
	}
}
