// Side-effect module: imported first in App.tsx so every later log is redacted.
import { installSafeConsole } from './safeConsole';

installSafeConsole();
