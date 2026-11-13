<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Controller;

use OCA\FlightJournal\Controller\SettingsApiController;
use OCA\FlightJournal\Service\ExportService;
use OCA\FlightJournal\Service\FlightService;
use OCA\FlightJournal\Service\ImportService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

class SettingsApiControllerTest extends TestCase {
	private ImportService&MockObject $importService;
	private ExportService&MockObject $exportService;
	private FlightService&MockObject $flights;
	private SettingsApiController $controller;

	protected function setUp(): void {
		parent::setUp();
		$this->importService = $this->createMock(ImportService::class);
		$this->exportService = $this->createMock(ExportService::class);
		$this->flights = $this->createMock(FlightService::class);

		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('alice');
		$session = $this->createMock(IUserSession::class);
		$session->method('getUser')->willReturn($user);

		$this->controller = new SettingsApiController(
			'flightjournal',
			$this->createMock(IRequest::class),
			$this->importService,
			$this->exportService,
			$this->flights,
			$session,
		);
	}

	public function testImportPassesTheReplaceFlagToTheJsonImport(): void {
		$result = ['imported' => 1, 'skipped' => [], 'deleted' => 3];
		$this->importService->expects($this->once())
			->method('importJson')
			->with('alice', '{"flights":[]}', true)
			->willReturn($result);

		$response = $this->controller->import('json', '{"flights":[]}', true);

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame($result, $response->getData());
	}

	public function testImportRoutesMarkdownToTheMarkdownImport(): void {
		$this->importService->expects($this->never())->method('importJson');
		$this->importService->expects($this->once())
			->method('importMarkdownTable')
			->with('alice', '| x |')
			->willReturn(['imported' => 0, 'skipped' => []]);

		$response = $this->controller->import('markdown', '| x |');

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
	}

	public function testImportRejectsAnUnknownFormat(): void {
		$this->importService->expects($this->never())->method($this->anything());

		$response = $this->controller->import('csv', 'a,b');

		$this->assertSame(Http::STATUS_BAD_REQUEST, $response->getStatus());
		$this->assertStringContainsString("'csv'", $response->getData()['message']);
	}

	public function testImportRejectsEmptyContent(): void {
		$this->importService->expects($this->never())->method($this->anything());

		$response = $this->controller->import('json', "  \n ");

		$this->assertSame(Http::STATUS_BAD_REQUEST, $response->getStatus());
	}

	public function testImportReportsARefusedReplaceAsABadRequest(): void {
		// The service refuses a replace with nothing valid in it; the client must
		// see an error with the reason, not a 200 "Imported 0".
		$this->importService->method('importJson')->willThrowException(
			new \InvalidArgumentException('Nothing to replace your flights with (entry 1: flightDate is required). Your existing flights were kept.'),
		);

		$response = $this->controller->import('json', '{"flights":[{}]}', true);

		$this->assertSame(Http::STATUS_BAD_REQUEST, $response->getStatus());
		$this->assertStringContainsString('existing flights were kept', $response->getData()['message']);
	}

	// The download paths are not unit-tested: DataDownloadResponse needs
	// symfony/string, which the nextcloud/ocp stubs do not ship.

	public function testExportRejectsAnUnknownFormatInsteadOfFallingBackToMarkdown(): void {
		$this->exportService->expects($this->never())->method($this->anything());

		$response = $this->controller->export('jsn');

		$this->assertInstanceOf(DataResponse::class, $response);
		$this->assertSame(Http::STATUS_BAD_REQUEST, $response->getStatus());
	}
}
