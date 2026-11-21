/**
 * The Cheques tab's status filter as it travels in the address. Home always names a status, "all"
 * included: a link without one would leave the tab on the filter of the previous visit, since
 * the router keeps (or merges) the params of a tab it returns to.
 */
import { isChequeStatus, type ChequeStatus } from './shared';

/** The param value for "every status". */
export const ALL_STATUSES = 'all';

export function chequeStatusParam(status: ChequeStatus | undefined): string {
  return status ?? ALL_STATUSES;
}

/** The filter a `status` param asks for; "all", nothing or anything unknown means every status. */
export function chequeStatusFromParam(param: unknown): ChequeStatus | undefined {
  return isChequeStatus(param) ? param : undefined;
}

/** Where Home's rent figures take the owner: the Cheques tab, filtered (or not) on purpose. */
export function chequesHref(status?: ChequeStatus) {
  return { pathname: '/(tabs)/cheques' as const, params: { status: chequeStatusParam(status) } };
}
