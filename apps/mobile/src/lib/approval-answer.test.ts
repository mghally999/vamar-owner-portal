import { describe, expect, it } from 'vitest';
import { isAlreadyAnswered, staleAfterAnswerError } from './approval-answer';

// The shape of ApiRequestError (src/lib/api.ts), which loads React Native and cannot run here.
function apiError(status: number) {
  return Object.assign(new Error('refused'), { status, code: 'conflict' });
}

describe('a refused approval answer', () => {
  it('refreshes the request and the lists around it after a 409', () => {
    expect(isAlreadyAnswered(apiError(409))).toBe(true);
    expect(staleAfterAnswerError(apiError(409), 'ap-1')).toEqual([
      ['approval', 'ap-1'],
      ['approvals'],
      ['work-orders'],
    ]);
  });

  it('leaves any other failure to a retry', () => {
    for (const e of [apiError(500), apiError(422), new Error('offline'), null, undefined]) {
      expect(isAlreadyAnswered(e)).toBe(false);
      expect(staleAfterAnswerError(e, 'ap-1')).toEqual([]);
    }
  });
});
