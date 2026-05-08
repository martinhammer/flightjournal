<?php

declare(strict_types=1);

namespace OCA\FlightJournal;

/**
 * @psalm-type FlightJournalFlight = array{
 *     id: int,
 *     flightDate: string,
 *     originCode: ?string,
 *     destinationCode: ?string,
 *     originLabel: ?string,
 *     destinationLabel: ?string,
 *     airlineCode: ?string,
 *     flightNumber: ?string,
 *     aircraftTypeCode: ?string,
 *     aircraftTypeRaw: ?string,
 *     registration: ?string,
 *     cabinClass: ?string,
 *     seat: ?string,
 *     notes: ?string,
 *     createdAt: int,
 *     updatedAt: int,
 * }
 *
 * @psalm-suppress UnusedClass
 */
class ResponseDefinitions {
}
