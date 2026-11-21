// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchSearch, readFilters, useUrlSearchText } from './url-filters';

afterEach(cleanup);

const DEFAULTS = { status: '', view: 'list', year: '' };

describe('readFilters', () => {
  it('takes each filter from the search, its default otherwise, and ignores other keys', () => {
    expect(readFilters({ status: 'bounced', preset: 'this_year' }, DEFAULTS)).toEqual({
      status: 'bounced',
      view: 'list',
      year: '',
    });
  });

  it('reads the numbers and booleans the router parses back as text', () => {
    expect(readFilters({ year: 2027, view: true, status: { x: 1 } }, DEFAULTS)).toEqual({
      status: '',
      view: 'true',
      year: '2027',
    });
  });
});

describe('patchSearch', () => {
  it('sets changed filters, drops the ones back at their default and keeps other keys', () => {
    expect(
      patchSearch(
        { preset: 'this_year', status: 'cleared', view: 'board' },
        { status: 'bounced', view: 'list' },
        DEFAULTS,
      ),
    ).toEqual({ preset: 'this_year', status: 'bounced' });
    expect(patchSearch({ status: 'x' }, { status: '' }, DEFAULTS)).toEqual({});
  });

  it('writes whole numbers as numbers so the URL reads ?year=2027, not a quoted string', () => {
    expect(patchSearch({}, { year: '2027' }, DEFAULTS)).toEqual({ year: 2027 });
    expect(patchSearch({}, { status: '007' }, DEFAULTS)).toEqual({ status: '007' });
    expect(patchSearch({}, { status: '1e3' }, DEFAULTS)).toEqual({ status: '1e3' });
  });
});

describe('useUrlSearchText', () => {
  function Box({ commit }: { commit: (v: string) => void }) {
    const [url, setUrl] = useState('first');
    const [text, setText] = useUrlSearchText(url, (v) => {
      commit(v);
      setUrl(v);
    });
    return (
      <>
        <input
          aria-label="q"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <button
          type="button"
          onClick={() => {
            setUrl('');
          }}
        >
          clear
        </button>
      </>
    );
  }

  it('commits the trimmed text once typing stops and follows a change made elsewhere', () => {
    vi.useFakeTimers();
    try {
      const commit = vi.fn();
      render(<Box commit={commit} />);
      const input = screen.getByLabelText<HTMLInputElement>('q');
      expect(input.value).toBe('first');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      // The value that came from the URL is not written back.
      expect(commit).not.toHaveBeenCalled();
      for (const v of ['f', 'fo', 'foo ']) {
        act(() => {
          fireEvent.change(input, { target: { value: v } });
          vi.advanceTimersByTime(100);
        });
      }
      expect(commit).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenLastCalledWith('foo');
      // Back, a link or a cleared chip changes the URL: the box shows it and nothing is re-sent.
      act(() => {
        screen.getByRole('button', { name: 'clear' }).click();
      });
      expect(input.value).toBe('');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(commit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
