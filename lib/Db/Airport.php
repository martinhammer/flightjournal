<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method string|null getIata()
 * @method void setIata(?string $iata)
 * @method string|null getIcao()
 * @method void setIcao(?string $icao)
 * @method string|null getName()
 * @method void setName(?string $name)
 * @method string|null getCity()
 * @method void setCity(?string $city)
 * @method string|null getState()
 * @method void setState(?string $state)
 * @method string|null getCountryIso2()
 * @method void setCountryIso2(?string $countryIso2)
 * @method float|null getLat()
 * @method void setLat(?float $lat)
 * @method float|null getLon()
 * @method void setLon(?float $lon)
 * @method int|null getElevation()
 * @method void setElevation(?int $elevation)
 * @method string|null getTz()
 * @method void setTz(?string $tz)
 * @method string|null getSource()
 * @method void setSource(?string $source)
 * @method int getUpdatedAt()
 * @method void setUpdatedAt(int $updatedAt)
 *
 * @psalm-suppress PropertyNotSetInConstructor
 */
class Airport extends Entity implements \JsonSerializable {
	protected ?string $iata = null;
	protected ?string $icao = null;
	protected ?string $name = null;
	protected ?string $city = null;
	protected ?string $state = null;
	protected ?string $countryIso2 = null;
	protected ?float $lat = null;
	protected ?float $lon = null;
	protected ?int $elevation = null;
	protected ?string $tz = null;
	protected ?string $source = null;
	protected int $updatedAt = 0;

	public function __construct() {
		$this->addType('lat', 'float');
		$this->addType('lon', 'float');
		$this->addType('elevation', 'integer');
		$this->addType('updatedAt', 'integer');
	}

	/**
	 * @return array{
	 *     id: int,
	 *     iata: ?string,
	 *     icao: ?string,
	 *     name: ?string,
	 *     city: ?string,
	 *     state: ?string,
	 *     countryIso2: ?string,
	 *     lat: ?float,
	 *     lon: ?float,
	 *     elevation: ?int,
	 *     tz: ?string,
	 *     source: ?string,
	 *     updatedAt: int,
	 * }
	 */
	public function jsonSerialize(): array {
		return [
			'id' => $this->id,
			'iata' => $this->iata,
			'icao' => $this->icao,
			'name' => $this->name,
			'city' => $this->city,
			'state' => $this->state,
			'countryIso2' => $this->countryIso2,
			'lat' => $this->lat,
			'lon' => $this->lon,
			'elevation' => $this->elevation,
			'tz' => $this->tz,
			'source' => $this->source,
			'updatedAt' => $this->updatedAt,
		];
	}
}
