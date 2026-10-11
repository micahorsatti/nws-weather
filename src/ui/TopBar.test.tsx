// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './components/TopBar';

afterEach(cleanup);

const baseProps = {
  updatedLabel: 'Updated just now',
  refreshing: false,
  onOpenPlaces: vi.fn(),
  onRefresh: vi.fn(),
  onOpenSettings: vi.fn(),
};

describe('the page heading', () => {
  it('has exactly one h1 once a place is shown (screen readers navigate by headings), hidden visually', () => {
    render(<TopBar title="Linn, KS" {...baseProps} />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('Weather for Linn, KS');
    expect(h1s[0].classList.contains('sr-only')).toBe(true);
    // The visible control is still the place button.
    expect(screen.getByRole('button', { name: 'Linn, KS. Change place' })).toBeTruthy();
  });

  it('shows the app name as the h1 before a place is chosen', () => {
    render(<TopBar title={null} {...baseProps} onRefresh={null} />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('NWS Weather');
  });
});
