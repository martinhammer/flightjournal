<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Controller;

use OCA\FlightJournal\Db\AircraftTypeMapper;
use OCA\FlightJournal\Db\FlightMapper;
use OCA\FlightJournal\Service\AircraftReconciliationService;
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
		private AircraftReconciliationService $reconciler,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * Report what a free-text aircraft entry resolves to, without saving.
	 *
	 * Exists so the flight editor can show the user the same answer
	 * reconciliation will reach on save. It delegates to the one resolver rather
	 * than letting the client approximate: the tiers (designator → exact model →
	 * punctuation-insensitive model) live on the server, and any client-side
	 * guess would drift from them and preview a match that never happens.
	 *
	 * `referenceLoaded` disambiguates the two ways a miss can happen — no match,
	 * versus no aircraft reference data on the instance at all. Only computed on
	 * a miss, so the common path stays a single lookup.
	 *
	 * @param string $q The free text as typed
	 * @return DataResponse<Http::STATUS_OK, array{match: ?array{code: string, manufacturer: ?string, model: ?string}, referenceLoaded: bool}, array{}>
	 *
	 * 200: Resolution reported (match may be null)
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/aircraft-types/resolve')]
	public function resolve(string $q = ''): DataResponse {
		$match = $this->reconciler->resolve($q);
		if ($match !== null) {
			return new DataResponse([
				'match' => [
					'code' => $match->code,
					'manufacturer' => $match->manufacturer,
					'model' => $match->model,
				],
				'referenceLoaded' => true,
			]);
		}
		return new DataResponse([
			'match' => null,
			'referenceLoaded' => $this->types->count() > 0,
		]);
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
