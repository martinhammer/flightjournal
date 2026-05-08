<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Controller;

use OCA\FlightJournal\Service\ExportService;
use OCA\FlightJournal\Service\FlightService;
use OCA\FlightJournal\Service\ImportService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\OpenAPI;
use OCP\AppFramework\Http\DataDownloadResponse;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * @psalm-suppress UnusedClass
 */
class SettingsApiController extends OCSController {
	public function __construct(
		string $appName,
		IRequest $request,
		private ImportService $importService,
		private ExportService $exportService,
		private FlightService $flights,
		private IUserSession $userSession,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * Import flights from a textual payload
	 *
	 * @param string $dataformat Import format identifier (currently only 'markdown')
	 * @param string $content The raw content to parse
	 * @return DataResponse<Http::STATUS_OK, array{imported: int, skipped: list<array{line: int, reason: string, raw: string}>}, array{}>|DataResponse<Http::STATUS_BAD_REQUEST, array{message: string}, array{}>
	 *
	 * 200: Import processed (may include skipped rows)
	 * 400: Unsupported dataformat or empty content
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/import')]
	public function import(string $dataformat, string $content): DataResponse {
		if ($dataformat !== 'markdown') {
			return new DataResponse(['message' => "Unsupported dataformat '$dataformat'"], Http::STATUS_BAD_REQUEST);
		}
		if (trim($content) === '') {
			return new DataResponse(['message' => 'Content is empty'], Http::STATUS_BAD_REQUEST);
		}
		$result = $this->importService->importMarkdownTable($this->getUserId(), $content);
		return new DataResponse($result);
	}

	/**
	 * Export the user's flights as a downloadable file
	 *
	 * @param string $dataformat Export format identifier (currently only 'markdown')
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/export')]
	#[OpenAPI(OpenAPI::SCOPE_IGNORE)]
	public function export(string $dataformat = 'markdown'): DataDownloadResponse {
		// Dataformat is reserved for future expansion; only markdown is supported today.
		unset($dataformat);
		$content = $this->exportService->exportMarkdownTable($this->getUserId());
		return new DataDownloadResponse($content, 'flightjournal-export.md', 'text/markdown');
	}

	/**
	 * Delete every flight belonging to the current user
	 *
	 * @return DataResponse<Http::STATUS_OK, array{deleted: int}, array{}>
	 *
	 * 200: Flights deleted
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/flights')]
	public function deleteAllFlights(): DataResponse {
		$count = $this->flights->deleteAll($this->getUserId());
		return new DataResponse(['deleted' => $count]);
	}

	private function getUserId(): string {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new \RuntimeException('No user in session');
		}
		return $user->getUID();
	}
}
