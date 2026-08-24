<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Service;

/**
 * The punctuation-insensitive lookup key for an aircraft model name.
 *
 * Users type "A320neo" or "A330-300"; DOC 8643 spells the same aircraft
 * "A-320neo" and "A-330-300". Reducing both sides to letters and digits lets
 * those meet without introducing fuzzy matching: the comparison is still exact
 * and still required to be unambiguous, it just ignores separators.
 *
 * Deliberately does NOT bridge a missing word — "787-9" still will not reach
 * "787-9 Dreamliner", and "A350-900" will not reach "A-350-900 XWB". Those need
 * the ICAO designator (B789 / A359), which is what the first tier is for.
 *
 * Shared by AircraftTypeImportService (which stores the key alongside each
 * model) and AircraftReconciliationService (which derives it from user input),
 * so the two can never drift apart.
 */
final class AircraftModelKey {
	/**
	 * Reduce a model name to lowercase letters and digits, or '' when nothing
	 * usable remains (in which case it must never be used as a lookup key).
	 */
	public static function normalize(?string $model): string {
		if ($model === null) {
			return '';
		}
		return (string)preg_replace('/[^a-z0-9]+/', '', mb_strtolower(trim($model)));
	}
}
