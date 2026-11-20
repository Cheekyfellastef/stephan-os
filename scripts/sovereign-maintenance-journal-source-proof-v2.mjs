// Fixed installer source proof. No caller-selected root, probe or command.
import { readMaintenanceRecoverySourceV1 } from './sovereign-maintenance-custody-store-v1.mjs';
try { console.log(readMaintenanceRecoverySourceV1()); }
catch { console.error('JOURNAL_INSTALL_SOURCE_UNPROVEN'); process.exitCode = 2; }
