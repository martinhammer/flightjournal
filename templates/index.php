<?php

declare(strict_types=1);

use OCP\Util;

Util::addScript(OCA\FlightJournal\AppInfo\Application::APP_ID, OCA\FlightJournal\AppInfo\Application::APP_ID . '-main');
Util::addStyle(OCA\FlightJournal\AppInfo\Application::APP_ID, OCA\FlightJournal\AppInfo\Application::APP_ID . '-main');

?>

<div id="flightjournal"></div>
