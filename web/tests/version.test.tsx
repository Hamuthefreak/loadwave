import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MarketingFooter } from '../src/components/Marketing';
import { APP_VERSION } from '../src/version';
import { renderRoute, setupDom, view } from './harness';

setupDom();

const packageVersion = (
  JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string }
).version;

describe('the release marker', () => {
  it('matches the version in package.json', () => {
    expect(APP_VERSION).toBe(packageVersion);
  });

  it('is shown discreetly in the site footer', () => {
    renderRoute(<MarketingFooter />);
    expect(view().querySelector('.ld-version')?.textContent).toBe(`v${APP_VERSION}`);
  });
});
