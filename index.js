import { collect } from './collect-deposits.js';
import { scan } from './scan-deposits.js';
import { topup } from './topup.js';

topup();
collect();
scan();
