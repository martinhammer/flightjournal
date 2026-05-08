<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

use OCA\FlightJournal\Db\Flight;
use OCA\FlightJournal\Db\FlightMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;

class FlightService {
	private const ALLOWED_CABIN_CLASSES = ['economy', 'premium_economy', 'business', 'first', 'other'];

	/** @psalm-suppress PossiblyUnusedMethod */
	public function __construct(
		private FlightMapper $mapper,
		private ITimeFactory $time,
	) {
	}

	/**
	 * @return Flight[]
	 */
	public function findAll(string $userId): array {
		return $this->mapper->findAllForUser($userId);
	}

	public function find(int $id, string $userId): Flight {
		try {
			return $this->mapper->findForUser($id, $userId);
		} catch (DoesNotExistException) {
			throw new NotFoundException("Flight $id not found");
		}
	}

	public function create(string $userId, array $data): Flight {
		$this->validate($data);
		$flight = new Flight();
		$flight->setUserId($userId);
		$this->applyData($flight, $data);
		$now = $this->time->getTime();
		$flight->setCreatedAt($now);
		$flight->setUpdatedAt($now);
		return $this->mapper->insert($flight);
	}

	public function update(int $id, string $userId, array $data): Flight {
		$flight = $this->find($id, $userId);
		$this->validate($data);
		$this->applyData($flight, $data);
		$flight->setUpdatedAt($this->time->getTime());
		return $this->mapper->update($flight);
	}

	public function delete(int $id, string $userId): void {
		$flight = $this->find($id, $userId);
		$this->mapper->delete($flight);
	}

	private function validate(array $data): void {
		$date = $this->str($data, 'flightDate');
		if ($date === null) {
			throw new ValidationException('flightDate is required');
		}
		if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
			throw new ValidationException('flightDate must be YYYY-MM-DD');
		}

		$hasOrigin = $this->str($data, 'originCode') !== null || $this->str($data, 'originLabel') !== null;
		$hasDestination = $this->str($data, 'destinationCode') !== null || $this->str($data, 'destinationLabel') !== null;
		if (!$hasOrigin && !$hasDestination) {
			throw new ValidationException('At least one of origin or destination is required');
		}

		$cabin = $this->str($data, 'cabinClass');
		if ($cabin !== null && !in_array($cabin, self::ALLOWED_CABIN_CLASSES, true)) {
			throw new ValidationException('Invalid cabinClass');
		}
	}

	private function applyData(Flight $flight, array $data): void {
		$flight->setFlightDate((string)$this->str($data, 'flightDate'));
		$flight->setOriginCode($this->upper($this->str($data, 'originCode')));
		$flight->setDestinationCode($this->upper($this->str($data, 'destinationCode')));
		$flight->setOriginLabel($this->str($data, 'originLabel'));
		$flight->setDestinationLabel($this->str($data, 'destinationLabel'));
		$flight->setAirlineCode($this->upper($this->str($data, 'airlineCode')));
		$flight->setFlightNumber($this->str($data, 'flightNumber'));
		$flight->setAircraftTypeCode($this->upper($this->str($data, 'aircraftTypeCode')));
		$flight->setAircraftTypeRaw($this->str($data, 'aircraftTypeRaw'));
		$flight->setRegistration($this->str($data, 'registration'));
		$flight->setCabinClass($this->str($data, 'cabinClass'));
		$flight->setSeat($this->str($data, 'seat'));
		$flight->setNotes($this->str($data, 'notes'));
	}

	private function str(array $data, string $key): ?string {
		$value = $data[$key] ?? null;
		if (!is_string($value)) {
			return null;
		}
		$trimmed = trim($value);
		return $trimmed === '' ? null : $trimmed;
	}

	private function upper(?string $value): ?string {
		return $value === null ? null : strtoupper($value);
	}

}
