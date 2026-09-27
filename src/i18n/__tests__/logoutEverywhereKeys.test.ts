import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const KEYS = ['logoutEverywhere', 'logoutEverywhereConfirm', 'logoutEverywhereError'];

describe('"log out everywhere" translations', () => {
  const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));

  it.each(files)('%s has every settings.logoutEverywhere* key', (file) => {
    const settings = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8')).settings ?? {};
    for (const key of KEYS) {
      expect(typeof settings[key]).toBe('string');
      expect(settings[key].trim()).not.toBe('');
    }
  });
});
