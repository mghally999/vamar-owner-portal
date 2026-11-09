// @vitest-environment jsdom
/**
 * The case page beyond the happy path: a whole-page retry, a case with sparse records (no
 * building, cheque numbers or bounce details, a fee without an invoice number, a file without a
 * name), refused saves of an update, an upload and the linked cheques, and closing the dialog.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/test/api';
import { chequeRow, disputeDetail } from '@/test/fixtures';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SPARSE_CHEQUE = {
  id: 'chq-9',
  chequeNo: null,
  bankName: null,
  amountFils: 1_000_000,
  dueDate: '2026-08-01',
  status: 'deposited',
  bouncedAt: null,
  bounceReason: null,
  contractId: 'con-1',
};

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/disputes/dsp-1': { ...disputeDetail(), cheques: [] },
    'GET /api/staff/expenses': { items: [], nextCursor: null, totals: {} },
    'GET /api/staff/cheques': {
      items: [chequeRow({ status: 'bounced' }), chequeRow({ id: 'chq-2', chequeNo: '000102' })],
      nextCursor: null,
    },
    'GET /api/staff/holidays': { items: [] },
    ...extra,
  };
}

async function dialogClosed() {
  await vi.waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
}

describe('DisputeDetailPage, more', () => {
  it('retries the case when it cannot load', async () => {
    let fail = true;
    const { user } = await renderApp('/disputes/dsp-1', {
      routes: routes({
        'GET /api/staff/disputes/dsp-1': () =>
          fail ? apiError(500, 'internal') : { ...disputeDetail(), cheques: [] },
      }),
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    await user.click(retry);
    expect(await screen.findByRole('heading', { name: 'Case RDC-2026-0412' })).toBeTruthy();
  });

  it('shows dashes for what a record does not have', async () => {
    await renderApp('/disputes/dsp-1', {
      role: 'viewer',
      routes: routes({
        'GET /api/staff/disputes/dsp-1': {
          ...disputeDetail({
            building: null,
            unit: null,
            nextHearingDate: null,
            attachments: [
              {
                id: 'att-5',
                fileName: '',
                mime: 'image/jpeg',
                sizeBytes: 51_200,
                createdAt: '2026-09-02T07:00:00.000Z',
              },
            ],
          } as never),
          cheques: [SPARSE_CHEQUE],
        },
        'GET /api/staff/expenses': {
          items: [
            {
              id: 'exp-2',
              reasonAr: 'رسوم خبير',
              reasonEn: 'Expert fee',
              invoiceNo: null,
              invoiceDate: '2026-09-25',
              totalFils: 120_000,
              status: 'draft',
            },
          ],
          nextCursor: null,
          totals: {},
        },
      }),
    });
    const cheque = (await screen.findByText('Deposited')).closest('tr');
    if (!cheque) throw new Error('no cheque row');
    // No number, bank, bounce date or reason: dashes, and the link still names the action.
    expect(within(cheque).getAllByText('—')).toHaveLength(4);
    expect(within(cheque).getByRole('link', { name: /Open cheque/ })).toBeTruthy();
    expect(screen.getByText('image/jpeg')).toBeTruthy();
    expect(screen.getByText('50 KB')).toBeTruthy();
    // A viewer cannot remove files.
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    const fee = (await screen.findByRole('link', { name: 'Expert fee' })).parentElement;
    if (!fee) throw new Error('no fee row');
    expect(within(fee).getByText(/· draft/)).toBeTruthy();
  });

  it('asks for a cheque on an empty bounced-cheque case and treats a failed fee list as none', async () => {
    await renderApp('/disputes/dsp-1', {
      routes: routes({
        'GET /api/staff/disputes/dsp-1': {
          ...disputeDetail({ type: 'bounced_cheque' }),
          cheques: [],
        },
        'GET /api/staff/expenses': apiError(500, 'internal'),
      }),
    });
    expect(
      await screen.findByText(
        'No cheques linked. A bounced-cheque case needs at least one cheque.',
      ),
    ).toBeTruthy();
    expect(await screen.findByText('No fees recorded for this case.')).toBeTruthy();
  });

  it('keeps the note and says so when an update is refused', async () => {
    const { user } = await renderApp('/disputes/dsp-1', {
      routes: routes({ 'POST /api/staff/disputes/dsp-1/updates': apiError(500, 'internal') }),
    });
    const note = await screen.findByRole('textbox', { name: 'Add update' });
    await user.type(note, 'Called the lawyer.');
    await user.click(screen.getByRole('button', { name: 'Add update' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(note).toHaveProperty('value', 'Called the lawyer.');
    expect(screen.queryByText('Update added.')).toBeNull();
  });

  it('opens the file picker from the button and reports a refused upload', async () => {
    const { api, user, container } = await renderApp('/disputes/dsp-1', {
      routes: routes({ 'POST /api/staff/attachments': apiError(500, 'internal') }),
    });
    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    const pick = vi.spyOn(input, 'click');
    await user.click(await screen.findByRole('button', { name: 'Upload file' }));
    expect(pick).toHaveBeenCalled();
    await user.upload(input, new File(['%PDF'], 'judgment.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(api.to('POST', '/api/staff/attachments')).toHaveLength(1);
    // The input is emptied so the same file can be picked again.
    expect(input.value).toBe('');
  });

  it('reports a refused cheque link and closes the dialog on cancel and Escape', async () => {
    const { api, user } = await renderApp('/disputes/dsp-1', {
      role: 'editor',
      routes: routes({ 'PUT /api/staff/disputes/dsp-1/cheques': apiError(500, 'internal') }),
    });
    await user.click(await screen.findByRole('button', { name: 'Link cheques' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('checkbox', { name: /000102/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(api.last('GET', '/api/staff/cheques').query).toMatchObject({ unitId: 'unit-801' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await dialogClosed();
    expect(screen.queryByText('Cheques linked.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Link cheques' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await dialogClosed();
  });
});
