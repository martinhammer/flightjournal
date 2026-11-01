<?php

declare(strict_types=1);

// Inside a server checkout (CI's phpunit-sqlite job, which removes
// nextcloud/ocp before running) the server's bootstrap defines OCP\*.
$serverBootstrap = __DIR__ . '/../../../tests/bootstrap.php';
if (is_file($serverBootstrap)) {
	require_once $serverBootstrap;
}

$autoloader = require_once __DIR__ . '/../vendor/autoload.php';

// nextcloud/ocp ships PHP stubs for the public API but does not register an
// autoloader of its own. Register a PSR-4 prefix so OCP\* classes resolve in
// unit tests without needing a full Nextcloud server checkout.
$ocpDir = __DIR__ . '/../vendor/nextcloud/ocp';
if (is_dir($ocpDir)) {
	$autoloader->addPsr4('OCP\\', $ocpDir . '/OCP');
	$autoloader->addPsr4('NCU\\', $ocpDir . '/NCU');
}
