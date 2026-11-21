import { describe, expect, it } from 'vitest';
import { chequeStatusFromParam, chequeStatusParam, chequesHref } from './cheque-filter';

describe('the Cheques status filter in the address', () => {
  it('names a status on every link from Home, "all" included', () => {
    expect(chequesHref('cleared')).toEqual({
      pathname: '/(tabs)/cheques',
      params: { status: 'cleared' },
    });
    // Without a status the tab would keep the filter of the previous visit.
    expect(chequesHref()).toEqual({ pathname: '/(tabs)/cheques', params: { status: 'all' } });
  });

  it('reads every value back, and anything unknown as every status', () => {
    expect(chequeStatusFromParam('bounced')).toBe('bounced');
    expect(chequeStatusFromParam(chequeStatusParam(undefined))).toBeUndefined();
    expect(chequeStatusFromParam(chequeStatusParam('upcoming'))).toBe('upcoming');
    expect(chequeStatusFromParam(undefined)).toBeUndefined();
    expect(chequeStatusFromParam('nonsense')).toBeUndefined();
    expect(chequeStatusFromParam(['cleared'])).toBeUndefined();
  });
});
