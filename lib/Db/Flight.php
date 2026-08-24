<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method string getFlightDate()
 * @method void setFlightDate(string $flightDate)
 * @method int getDaySeq()
 * @method void setDaySeq(int $daySeq)
 * @method string|null getOriginCode()
 * @method void setOriginCode(?string $originCode)
 * @method string|null getDestinationCode()
 * @method void setDestinationCode(?string $destinationCode)
 * @method string|null getOriginLabel()
 * @method void setOriginLabel(?string $originLabel)
 * @method string|null getDestinationLabel()
 * @method void setDestinationLabel(?string $destinationLabel)
 * @method string|null getAirlineCode()
 * @method void setAirlineCode(?string $airlineCode)
 * @method string|null getFlightNumber()
 * @method void setFlightNumber(?string $flightNumber)
 * @method string|null getAircraftTypeCode()
 * @method void setAircraftTypeCode(?string $aircraftTypeCode)
 * @method string|null getAircraftTypeRaw()
 * @method void setAircraftTypeRaw(?string $aircraftTypeRaw)
 * @method string|null getAircraftManufacturer()
 * @method void setAircraftManufacturer(?string $aircraftManufacturer)
 * @method string|null getAircraftModel()
 * @method void setAircraftModel(?string $aircraftModel)
 * @method string|null getRegistration()
 * @method void setRegistration(?string $registration)
 * @method string|null getCabinClass()
 * @method void setCabinClass(?string $cabinClass)
 * @method string|null getSeat()
 * @method void setSeat(?string $seat)
 * @method string|null getNotes()
 * @method void setNotes(?string $notes)
 * @method int|null getDistanceKm()
 * @method void setDistanceKm(?int $distanceKm)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method int getUpdatedAt()
 * @method void setUpdatedAt(int $updatedAt)
 *
 * @psalm-suppress PropertyNotSetInConstructor
 * @psalm-suppress PossiblyUnusedProperty
 */
class Flight extends Entity implements \JsonSerializable {
	protected string $userId = '';
	protected string $flightDate = '';
	protected int $daySeq = 0;
	protected ?string $originCode = null;
	protected ?string $destinationCode = null;
	protected ?string $originLabel = null;
	protected ?string $destinationLabel = null;
	protected ?string $airlineCode = null;
	protected ?string $flightNumber = null;
	protected ?string $aircraftTypeCode = null;
	protected ?string $aircraftTypeRaw = null;
	/**
	 * The reference model this flight resolved to, denormalised onto the row the
	 * same way airport reconciliation copies the reference airport name into
	 * origin_label. Stored as the natural key rather than a reference id so it
	 * survives a reference re-import and stays meaningful in a JSON backup
	 * restored on another instance.
	 */
	protected ?string $aircraftManufacturer = null;
	protected ?string $aircraftModel = null;
	protected ?string $registration = null;
	protected ?string $cabinClass = null;
	protected ?string $seat = null;
	protected ?string $notes = null;
	protected ?int $distanceKm = null;
	protected int $createdAt = 0;
	protected int $updatedAt = 0;

	public function __construct() {
		$this->addType('daySeq', 'integer');
		$this->addType('distanceKm', 'integer');
		$this->addType('createdAt', 'integer');
		$this->addType('updatedAt', 'integer');
	}

	/**
	 * @return array{
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
	 *     aircraftManufacturer: ?string,
	 *     aircraftModel: ?string,
	 *     registration: ?string,
	 *     cabinClass: ?string,
	 *     seat: ?string,
	 *     notes: ?string,
	 *     distanceKm: ?int,
	 *     createdAt: int,
	 *     updatedAt: int,
	 * }
	 */
	public function jsonSerialize(): array {
		return [
			'id' => $this->id,
			'flightDate' => $this->flightDate,
			'daySeq' => $this->daySeq,
			'originCode' => $this->originCode,
			'destinationCode' => $this->destinationCode,
			'originLabel' => $this->originLabel,
			'destinationLabel' => $this->destinationLabel,
			'airlineCode' => $this->airlineCode,
			'flightNumber' => $this->flightNumber,
			'aircraftTypeCode' => $this->aircraftTypeCode,
			'aircraftTypeRaw' => $this->aircraftTypeRaw,
			'aircraftManufacturer' => $this->aircraftManufacturer,
			'aircraftModel' => $this->aircraftModel,
			'registration' => $this->registration,
			'cabinClass' => $this->cabinClass,
			'seat' => $this->seat,
			'notes' => $this->notes,
			'distanceKm' => $this->distanceKm,
			'createdAt' => $this->createdAt,
			'updatedAt' => $this->updatedAt,
		];
	}
}
