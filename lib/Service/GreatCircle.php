<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

/**
 * Great-circle (haversine) distance between two points, in whole kilometres.
 *
 * Pure and deterministic: the same coordinates always yield the same result,
 * which is why the distance is treated as a derived flight property rather than
 * refreshable enrichment cache.
 */
final class GreatCircle {
	/** Mean Earth radius (IUGG), km. */
	private const EARTH_RADIUS_KM = 6371.0088;

	public static function distanceKm(float $lat1, float $lon1, float $lat2, float $lon2): int {
		$dLat = deg2rad($lat2 - $lat1);
		$dLon = deg2rad($lon2 - $lon1);
		$a = sin($dLat / 2) ** 2
			+ cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
		$c = 2 * atan2(sqrt($a), sqrt(1 - $a));
		return (int)round(self::EARTH_RADIUS_KM * $c);
	}
}
