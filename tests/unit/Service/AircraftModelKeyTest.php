<?php

declare(strict_types=1);

namespace OCA\FlightJournal\Tests\Unit\Service;

use OCA\FlightJournal\Service\AircraftModelKey;
use PHPUnit\Framework\TestCase;

class AircraftModelKeyTest extends TestCase {
	/**
	 * The pairs this exists to make meet: what a user types on the left, how
	 * DOC 8643 spells it on the right.
	 *
	 * @return list<array{0: string, 1: string}>
	 */
	public static function equivalentPairs(): array {
		return [
			['A320neo', 'A-320neo'],
			['A321neo', 'A-321neo'],
			['A330-300', 'A-330-300'],
			['A340-600', 'A-340-600'],
			['A380-800', 'A-380-800'],
			['A220-300', 'A-220-300'],
			['737 800', '737-800'],
			['b738', 'B738'],
		];
	}

	/**
	 * @dataProvider equivalentPairs
	 */
	public function testSeparatorAndCaseVariantsShareAKey(string $typed, string $reference): void {
		$this->assertSame(
			AircraftModelKey::normalize($reference),
			AircraftModelKey::normalize($typed),
		);
	}

	/**
	 * The deliberate limit: normalisation removes separators, it does not bridge
	 * a missing word. These must stay distinct so they resolve via the designator
	 * tier or not at all, rather than by guesswork.
	 *
	 * @return list<array{0: string, 1: string}>
	 */
	public static function distinctPairs(): array {
		return [
			['787-9', '787-9 Dreamliner'],
			['A350-900', 'A-350-900 XWB'],
			['B737-800', '737-800'],
			['737-800', '737-900'],
		];
	}

	/**
	 * @dataProvider distinctPairs
	 */
	public function testMissingWordsAreNotBridged(string $typed, string $reference): void {
		$this->assertNotSame(
			AircraftModelKey::normalize($reference),
			AircraftModelKey::normalize($typed),
		);
	}

	public function testStripsEverythingButLettersAndDigits(): void {
		$this->assertSame('cl600regionaljetcrj900', AircraftModelKey::normalize('CL-600 Regional Jet CRJ-900'));
	}

	public function testTrimsSurroundingWhitespace(): void {
		$this->assertSame('a320', AircraftModelKey::normalize('  A-320  '));
	}

	/**
	 * A key of '' must never be used as a lookup — callers guard on it, so the
	 * contract that punctuation-only input normalises to empty matters.
	 */
	public function testNullAndPunctuationOnlyInputYieldAnEmptyKey(): void {
		$this->assertSame('', AircraftModelKey::normalize(null));
		$this->assertSame('', AircraftModelKey::normalize('   '));
		$this->assertSame('', AircraftModelKey::normalize('---'));
	}
}
