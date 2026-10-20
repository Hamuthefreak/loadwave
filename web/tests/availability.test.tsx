import AvailabilityGate, {
  UNAVAILABLE_MESSAGE,
  type Availability,
} from '../src/components/AvailabilityGate';
import { renderRoute, settle, setupDom, view } from './harness';

setupDom();

const answer = (value: Availability | null) => () => Promise.resolve(value);

const availability = (overrides: Partial<Availability>): Availability => ({
  country: 'CA',
  region: 'north-america',
  available: true,
  checked: true,
  ...overrides,
});

const renderGate = async (check: () => Promise<Availability | null>) => {
  renderRoute(
    <AvailabilityGate check={check}>
      <p>the product</p>
    </AvailabilityGate>,
  );
  await settle();
};

describe('AvailabilityGate', () => {
  it('replaces the product with the notice outside North America and Europe', async () => {
    await renderGate(
      answer(availability({ country: 'BR', region: null, available: false })),
    );

    expect(view().textContent).toContain(UNAVAILABLE_MESSAGE);
    expect(view().textContent).not.toContain('the product');
  });

  it.each([
    ['Canada', availability({ country: 'CA', region: 'north-america' })],
    ['the United States', availability({ country: 'US', region: 'north-america' })],
    ['Europe', availability({ country: 'FR', region: 'europe' })],
  ])('renders the product for %s', async (_label, result) => {
    await renderGate(answer(result));

    expect(view().textContent).toContain('the product');
    expect(view().textContent).not.toContain(UNAVAILABLE_MESSAGE);
  });

  it('fails open when the country is unknown', async () => {
    await renderGate(answer(availability({ country: null, region: null, checked: false })));

    expect(view().textContent).toContain('the product');
    expect(view().textContent).not.toContain(UNAVAILABLE_MESSAGE);
  });

  it('fails open when the lookup itself fails', async () => {
    await renderGate(() => Promise.reject(new Error('offline')));

    expect(view().textContent).toContain('the product');
  });
});
