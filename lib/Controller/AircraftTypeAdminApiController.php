<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Controller;

use OCA\FlightJournal\Db\AircraftTypeMapper;
use OCA\FlightJournal\Service\AircraftTypeImportService;
use OCA\FlightJournal\Service\ValidationException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\OpenAPI;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/**
 * Admin-only endpoints for managing the instance-wide aircraft type reference
 * table, mirroring AirportAdminApiController.
 *
 * Routes intentionally omit #[NoAdminRequired] so the framework restricts them
 * to administrators.
 *
 * @psalm-suppress UnusedClass
 */
class AircraftTypeAdminApiController extends OCSController {
	public function __construct(
		string $appName,
		IRequest $request,
		private AircraftTypeImportService $importer,
		private AircraftTypeMapper $types,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * Import aircraft reference data from a DOC 8643 CSV export.
	 *
	 * @param string $content Raw CSV, taken verbatim as downloaded
	 * @return DataResponse<Http::STATUS_OK, array{imported: int, updated: int, skipped: list<array{key: string, reason: string}>}, array{}>|DataResponse<Http::STATUS_BAD_REQUEST, array{message: string}, array{}>
	 *
	 * 200: Import processed (may include skipped rows)
	 * 400: Payload empty or invalid
	 */
	#[ApiRoute(verb: 'POST', url: '/api/v1/admin/aircraft-types/import')]
	#[OpenAPI(OpenAPI::SCOPE_ADMINISTRATION)]
	public function import(string $content): DataResponse {
		if (trim($content) === '') {
			return new DataResponse(['message' => 'Content is empty'], Http::STATUS_BAD_REQUEST);
		}
		try {
			$result = $this->importer->importCsv($content);
		} catch (ValidationException $e) {
			return new DataResponse(['message' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		}
		return new DataResponse($result);
	}

	/**
	 * Delete every aircraft type record.
	 *
	 * @return DataResponse<Http::STATUS_OK, array{deleted: int}, array{}>
	 *
	 * 200: Aircraft types deleted
	 */
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/admin/aircraft-types')]
	#[OpenAPI(OpenAPI::SCOPE_ADMINISTRATION)]
	public function deleteAll(): DataResponse {
		$count = $this->types->deleteAll();
		return new DataResponse(['deleted' => $count]);
	}

	/**
	 * Return the current count of aircraft types in the reference table.
	 *
	 * @return DataResponse<Http::STATUS_OK, array{count: int}, array{}>
	 *
	 * 200: Count returned
	 */
	#[ApiRoute(verb: 'GET', url: '/api/v1/admin/aircraft-types/count')]
	#[OpenAPI(OpenAPI::SCOPE_ADMINISTRATION)]
	public function count(): DataResponse {
		return new DataResponse(['count' => $this->types->count()]);
	}
}
