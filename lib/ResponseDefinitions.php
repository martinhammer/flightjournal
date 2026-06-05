<?php

declare(strict_types=1);

namespace OCA\FlightJournal;

/**
 * @psalm-type FlightJournalFlight = array{
 *     id: int,
 *     flightDate: string,
 *     daySeq: int,
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
 *     distanceKm: ?int,
 *     createdAt: int,
 *     updatedAt: int,
 * }
 *
 * @psalm-suppress UnusedClass
 */
class ResponseDefinitions {
}
