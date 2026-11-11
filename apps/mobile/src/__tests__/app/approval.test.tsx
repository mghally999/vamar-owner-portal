import { fireEvent, screen } from '@testing-library/react-native';
import ApprovalScreen from '../../../app/approval/[id]';
import ApprovalsScreen from '../../../app/approvals';
import WorkOrderDetailScreen from '../../../app/work-order/[id]';
import WorkOrdersScreen from '../../../app/work-orders';
import type { ApprovalDetail } from '@/lib/approval-types';
import { setAccessToken } from '@/lib/api';
import { mockApi, sent } from '@/test/api';
import { workOrder, workOrderDetail } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { routeState, router } from '@/test/router';

function approval(over: Partial<ApprovalDetail> = {}): ApprovalDetail {
  return {
    id: 'ap-1',
    kind: 'work_order',
    workOrderId: 'wo-1',
    expenseId: null,
    titleAr: 'تبديل سخان الماء',
    titleEn: 'Replace water heater',
    buildingNameAr: 'برج الواحة',
    buildingNameEn: 'Oasis Tower',
    unitNo: '1204',
    vendorName: 'Cool Breeze AC Services',
    amountFils: 1_200_000,
    shareFils: 720_000,
    status: 'pending',
    note: null,
    askedOn: '2026-10-06',
    answeredAt: null,
    deadline: '2026-10-09',
    waiting: true,
    canAnswer: true,
    description: 'The heater leaks into the unit below.',
    attachments: [{ id: 'att-1', fileName: 'quote.jpg', mime: 'image/jpeg', sizeBytes: 3 }],
    ...over,
  };
}

beforeEach(() => {
  setAccessToken('access-1');
  routeState.params = { id: 'ap-1' };
});

describe('Approval request', () => {
  it('shows the share, estimate, contractor, reason, photo and deadline in English', async () => {
    mockApi({ 'GET /api/owner/approvals/ap-1': { body: approval() } });
    await renderApp(<ApprovalScreen />);
    expect(await screen.findByText('Replace water heater')).toBeTruthy();
    expect(screen.getByText('Awaiting answer')).toBeTruthy();
    expect(screen.getByText('Maintenance · Oasis Tower 1204')).toBeTruthy();
    expect(screen.getByText('Your share')).toBeTruthy();
    expect(screen.getByText('AED 7,200')).toBeTruthy();
    expect(screen.getByText('Estimated cost: AED 12,000')).toBeTruthy();
    expect(screen.getByText('Cool Breeze AC Services')).toBeTruthy();
    expect(screen.getByText('The heater leaks into the unit below.')).toBeTruthy();
    expect(
      screen.getByText("If you don't answer by 9 Oct 2026 it counts as approved."),
    ).toBeTruthy();
    const photo = screen.getByLabelText('quote.jpg');
    expect(JSON.stringify(photo.props)).toContain('/api/owner/attachments/att-1');
    // The signed-in session's token (refreshed on start) goes with the image request.
    expect(JSON.stringify(photo.props)).toMatch(/Bearer access-\d/);
  });

  it('approves with the note and then shows the answer read-only', async () => {
    mockApi({
      'GET /api/owner/approvals/ap-1': { body: approval() },
      'POST /api/owner/approvals/ap-1': (req) => {
        const body = req.body as { decision: string; note: string | null };
        return {
          body: approval({
            status: 'approved',
            note: body.note,
            answeredAt: '2026-10-07T08:00:00Z',
            canAnswer: false,
            deadline: null,
          }),
        };
      },
    });
    await renderApp(<ApprovalScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Note (optional)'), '  Go ahead  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Your answer')).toBeTruthy();
    expect(sent('POST /api/owner/approvals/ap-1')[0]?.body).toEqual({
      decision: 'approve',
      note: 'Go ahead',
    });
    // The status chip and the answer row.
    expect(screen.getAllByText('Approved')).toHaveLength(2);
    expect(screen.getByText('Go ahead')).toBeTruthy();
    expect(screen.getByText('7 Oct 2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('rejects only after a second, explicit tap; an empty note is sent as null', async () => {
    mockApi({
      'GET /api/owner/approvals/ap-1': { body: approval() },
      'POST /api/owner/approvals/ap-1': {
        body: approval({
          status: 'rejected',
          canAnswer: false,
          answeredAt: '2026-10-07T08:00:00Z',
        }),
      },
    });
    await renderApp(<ApprovalScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Reject' }));
    expect(sent('POST /api/owner/approvals/ap-1')).toHaveLength(0);
    // Changing one's mind goes back to both buttons.
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Reject' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(await screen.findAllByText('Rejected')).toHaveLength(2);
    expect(sent('POST /api/owner/approvals/ap-1')[0]?.body).toEqual({
      decision: 'reject',
      note: null,
    });
  });

  it('says when the answer could not be sent and keeps the buttons', async () => {
    mockApi({
      'GET /api/owner/approvals/ap-1': { body: approval() },
      'POST /api/owner/approvals/ap-1': {
        status: 409,
        body: { error: { code: 'conflict', message: 'already answered' } },
      },
    });
    await renderApp(<ApprovalScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('Your answer could not be sent. Please try again.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('a job that no longer waits shows no buttons; silence and no deadline read as such', async () => {
    mockApi({
      'GET /api/owner/approvals/ap-1': {
        body: approval({ waiting: false, canAnswer: false, deadline: null }),
      },
    });
    await renderApp(<ApprovalScreen />);
    expect(await screen.findByText('This job no longer needs your answer.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByText(/counts as approved/)).toBeNull();

    mockApi({
      'GET /api/owner/approvals/ap-1': {
        body: approval({
          status: 'approved_by_silence',
          canAnswer: false,
          deadline: null,
          answeredAt: '2026-10-09T04:00:00Z',
        }),
      },
    });
    await renderApp(<ApprovalScreen />);
    expect((await screen.findAllByText('Approved by silence')).length).toBeGreaterThan(0);
  });

  it('shows the error state with a retry when the request is not the owner’s (404)', async () => {
    mockApi({
      'GET /api/owner/approvals/ap-1': {
        status: 404,
        body: { error: { code: 'not_found', message: 'Approval not found' } },
      },
    });
    await renderApp(<ApprovalScreen />);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('Replace water heater')).toBeNull();
  });

  it('reads in Arabic with Western digits', async () => {
    mockApi({ 'GET /api/owner/approvals/ap-1': { body: approval() } });
    await renderApp(<ApprovalScreen />, { lang: 'ar' });
    expect(await screen.findByText('تبديل سخان الماء')).toBeTruthy();
    expect(screen.getByText('بانتظار الرد')).toBeTruthy();
    expect(screen.getByText('حصتك')).toBeTruthy();
    expect(screen.getByText('المقاول')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'موافقة' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'رفض' })).toBeTruthy();
    const deadline = screen.getByText(/تُعتبر موافقاً/);
    expect(JSON.stringify(deadline.props.children)).toMatch(/2026/);
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/[٠-٩]/);
  });
});

describe('Ways in', () => {
  it('lists the requests and opens one', async () => {
    mockApi({
      'GET /api/owner/approvals': {
        body: {
          items: [
            approval(),
            approval({
              id: 'ap-2',
              titleEn: 'Repaint corridor',
              status: 'approved',
              canAnswer: false,
            }),
          ],
        },
      },
    });
    await renderApp(<ApprovalsScreen />);
    expect(await screen.findByText('Replace water heater')).toBeTruthy();
    expect(screen.getByText('Repaint corridor')).toBeTruthy();
    await fireEvent.press(screen.getByText('Repaint corridor'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/approval/[id]',
      params: { id: 'ap-2' },
    });
  });

  it('says when there are none', async () => {
    mockApi({ 'GET /api/owner/approvals': { body: { items: [] } } });
    await renderApp(<ApprovalsScreen />, { lang: 'ar' });
    expect(await screen.findByText('لا توجد طلبات موافقة.')).toBeTruthy();
  });

  it('the job shows a card to the request and the maintenance list a banner', async () => {
    routeState.params = { id: 'wo-1' };
    mockApi({
      'GET /api/owner/work-orders/wo-1': { body: workOrderDetail({ status: 'scheduled' }) },
      'GET /api/owner/approvals': (req) =>
        req.query.get('workOrderId') === 'wo-1' || req.query.get('status') === 'pending'
          ? { body: { items: [approval()] } }
          : { body: { items: [] } },
      'GET /api/owner/work-orders': { body: { items: [workOrder()], nextCursor: null } },
    });
    await renderApp(<WorkOrderDetailScreen />);
    await fireEvent.press(await screen.findByText('Your approval is needed'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/approval/[id]',
      params: { id: 'ap-1' },
    });

    await renderApp(<WorkOrdersScreen />);
    await fireEvent.press(await screen.findByText('Awaiting your approval (1)'));
    expect(router.push).toHaveBeenLastCalledWith('/approvals');
  });
});
