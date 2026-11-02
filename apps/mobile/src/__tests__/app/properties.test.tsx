import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import PropertiesScreen from '../../../app/(tabs)/properties';
import { mockApi, sent } from '@/test/api';
import { building, unit } from '@/test/fixtures';
import { pullToRefresh, renderApp } from '@/test/render';
import { router } from '@/test/router';

const units = [
  unit(),
  unit({ id: 'unit-2', unitNo: '1205', shareBp: 2_500, annualRentFils: 9_000_000 }),
  unit({
    id: 'unit-3',
    unitNo: '702',
    occupied: false,
    tenantName: null,
    contractEndDate: null,
    annualRentFils: null,
    vacantSince: '2026-08-01',
  }),
  unit({
    id: 'unit-4',
    unitNo: 'G01',
    buildingId: 'bld-2',
    occupied: false,
    tenantName: null,
    annualRentFils: null,
    vacantSince: null,
  }),
];

beforeEach(() => {
  mockApi({
    'GET /api/owner/buildings': {
      body: {
        items: [
          building(),
          building({
            id: 'bld-2',
            nameEn: 'Al Nada Villa',
            area: 'Jumeirah',
            unitCount: 1,
            occupiedCount: 0,
          }),
        ],
      },
    },
    'GET /api/owner/units': { body: { items: units } },
  });
});

describe('Properties', () => {
  it('lists each building with its occupancy and its units', async () => {
    await renderApp(<PropertiesScreen />);
    expect(await screen.findByText('Oasis Tower')).toBeTruthy();
    expect(screen.getByText('Dubai Marina')).toBeTruthy();
    expect(screen.getByText('3 units')).toBeTruthy();
    expect(screen.getByText('2 rented')).toBeTruthy();
    expect(screen.getByText('Al Nada Villa')).toBeTruthy();
    expect(screen.getByText('0 rented')).toBeTruthy();
    expect(
      screen
        .getAllByRole('progressbar')
        .map((b) => (b.props as { accessibilityValue: { now: number } }).accessibilityValue.now),
    ).toEqual([67, 0]);

    expect(await screen.findByText('AED 120,000')).toBeTruthy();
    expect(screen.getByText('AED 90,000')).toBeTruthy();
    expect(screen.getByText('Your share 25%', { exact: false })).toBeTruthy();
    expect(screen.getAllByText('Ahmed Rahman · Contract ends 31 Mar 2027')).toHaveLength(2);
    expect(screen.getAllByText('Vacant')).toHaveLength(2);
    expect(screen.getByText('Vacant since 1 Aug 2026')).toBeTruthy();
    expect(screen.getByText('Never rented')).toBeTruthy();
    expect(screen.queryByText(/Showing the first 200 units/)).toBeNull();
  });

  it('opens a unit', async () => {
    await renderApp(<PropertiesScreen />);
    await fireEvent.press(await screen.findByText('Never rented'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/unit/[id]', params: { id: 'unit-4' } });
  });

  it('says when the unit list was cut off', async () => {
    mockApi({ 'GET /api/owner/units': { body: { items: units, truncated: true } } });
    await renderApp(<PropertiesScreen />);
    expect(
      await screen.findByText('Showing the first 200 units. Open a building to see the rest.'),
    ).toBeTruthy();
  });

  it('shows the buildings while their units are still loading', async () => {
    mockApi({ 'GET /api/owner/units': () => new Promise(() => undefined) });
    await renderApp(<PropertiesScreen />);
    expect(await screen.findByText('Oasis Tower')).toBeTruthy();
    expect(screen.queryByText('Vacant')).toBeNull();
  });

  it('shows placeholders while the buildings load', async () => {
    mockApi({ 'GET /api/owner/buildings': () => new Promise(() => undefined) });
    await renderApp(<PropertiesScreen />);
    await waitFor(() => {
      expect(sent('GET /api/owner/buildings')).toHaveLength(1);
    });
    expect(screen.queryByText('Oasis Tower')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('explains an empty portfolio', async () => {
    mockApi({ 'GET /api/owner/buildings': { body: { items: [] } } });
    await renderApp(<PropertiesScreen />);
    expect(
      await screen.findByText(
        'No properties are linked to your account yet. Contact Vamar if this is unexpected.',
      ),
    ).toBeTruthy();
  });

  it('shows an error with a retry', async () => {
    mockApi({ 'GET /api/owner/buildings': { status: 503, body: {} } });
    await renderApp(<PropertiesScreen />);
    mockApi({ 'GET /api/owner/buildings': { body: { items: [building()] } } });
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Oasis Tower')).toBeTruthy();
  });

  it('reloads buildings and units when pulled', async () => {
    await renderApp(<PropertiesScreen />);
    await screen.findByText('Oasis Tower');
    await pullToRefresh();
    await waitFor(() => {
      expect(sent('GET /api/owner/buildings')).toHaveLength(2);
    });
    expect(sent('GET /api/owner/units')).toHaveLength(2);
  });
});
