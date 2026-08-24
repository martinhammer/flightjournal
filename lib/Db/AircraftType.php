<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Db;

use OCP\AppFramework\Db\Entity;

/**
 * One row per aircraft *model*, not per ICAO designator — see
 * Migration\Version0004… for why the grain moved. `icaoCode` groups the models
 * that share a designator; `(manufacturer, model)` identifies the row.
 *
 * `canonical` marks the one row a designator resolves to by default. Everything
 * from `engineType` onward is functionally determined by the designator and so
 * repeats across its models.
 *
 * @method string getIcaoCode()
 * @method void setIcaoCode(string $icaoCode)
 * @method string|null getIataCode()
 * @method void setIataCode(?string $iataCode)
 * @method string|null getManufacturer()
 * @method void setManufacturer(?string $manufacturer)
 * @method string|null getModel()
 * @method void setModel(?string $model)
 * @method string|null getModelNormalized()
 * @method void setModelNormalized(?string $modelNormalized)
 * @method string|null getEngineType()
 * @method void setEngineType(?string $engineType)
 * @method int|null getEngineCount()
 * @method void setEngineCount(?int $engineCount)
 * @method string|null getWtc()
 * @method void setWtc(?string $wtc)
 * @method string|null getDescription()
 * @method void setDescription(?string $description)
 * @method bool getCanonical()
 * @method void setCanonical(bool $canonical)
 * @method string|null getSource()
 * @method void setSource(?string $source)
 * @method int getUpdatedAt()
 * @method void setUpdatedAt(int $updatedAt)
 *
 * @psalm-suppress PropertyNotSetInConstructor
 */
class AircraftType extends Entity implements \JsonSerializable {
	protected string $icaoCode = '';
	protected ?string $iataCode = null;
	protected ?string $manufacturer = null;
	protected ?string $model = null;
	/** Punctuation-insensitive lookup key for `model`; see Service\AircraftModelKey. */
	protected ?string $modelNormalized = null;
	protected ?string $engineType = null;
	protected ?int $engineCount = null;
	protected ?string $wtc = null;
	protected ?string $description = null;
	protected bool $canonical = false;
	protected ?string $source = null;
	protected int $updatedAt = 0;

	public function __construct() {
		$this->addType('engineCount', 'integer');
		$this->addType('canonical', 'boolean');
		$this->addType('updatedAt', 'integer');
	}

	/**
	 * @return array{
	 *     id: int,
	 *     icaoCode: string,
	 *     iataCode: ?string,
	 *     manufacturer: ?string,
	 *     model: ?string,
	 *     modelNormalized: ?string,
	 *     engineType: ?string,
	 *     engineCount: ?int,
	 *     wtc: ?string,
	 *     description: ?string,
	 *     canonical: bool,
	 *     source: ?string,
	 *     updatedAt: int,
	 * }
	 */
	public function jsonSerialize(): array {
		return [
			'id' => $this->id,
			'icaoCode' => $this->icaoCode,
			'iataCode' => $this->iataCode,
			'manufacturer' => $this->manufacturer,
			'model' => $this->model,
			'modelNormalized' => $this->modelNormalized,
			'engineType' => $this->engineType,
			'engineCount' => $this->engineCount,
			'wtc' => $this->wtc,
			'description' => $this->description,
			'canonical' => $this->canonical,
			'source' => $this->source,
			'updatedAt' => $this->updatedAt,
		];
	}
}
