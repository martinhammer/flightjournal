<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Service;

use OCA\FlightJournal\Service\GreatCircle;
use PHPUnit\Framework\TestCase;

class GreatCircleTest extends TestCase {
	public function testZeroForIdenticalPoints(): void {
		$this->assertSame(0, GreatCircle::distanceKm(51.47, -0.4543, 51.47, -0.4543));
	}

	public function testQuarterOfEquatorIsAboutTenThousandKm(): void {
		// 90° along the equator is a quarter of the great circle: ~10008 km.
		$this->assertEqualsWithDelta(10008, GreatCircle::distanceKm(0.0, 0.0, 0.0, 90.0), 2);
	}

	public function testAntipodalPointsAreHalfTheCircumference(): void {
		$this->assertEqualsWithDelta(20015, GreatCircle::distanceKm(0.0, 0.0, 0.0, 180.0), 2);
	}

	public function testSymmetric(): void {
		$ab = GreatCircle::distanceKm(55.618, 12.656, 51.47, -0.4543);
		$ba = GreatCircle::distanceKm(51.47, -0.4543, 55.618, 12.656);
		$this->assertSame($ab, $ba);
	}

	public function testKnownCityPairLondonToNewYork(): void {
		// LHR (51.4700, -0.4543) → JFK (40.6413, -73.7781): ~5555 km great circle.
		$this->assertEqualsWithDelta(5555, GreatCircle::distanceKm(51.47, -0.4543, 40.6413, -73.7781), 30);
	}
}
