import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ShareScanResults from './ShareScanResults';

const report = {
  type: 'capitalFlow',
  title: 'Capital Flow scan results',
  scanTime: '2026-11-03T12:30:00Z',
  rows: [{ symbol: 'DEMO', name: 'Example Holdings', price: 125, volumeRatio: 2.3 }],
};

const dialogPrototype = HTMLDialogElement.prototype;
const nativeShowModal = Object.getOwnPropertyDescriptor(dialogPrototype, 'showModal');

beforeEach(() => {
  if (!nativeShowModal) {
    Object.defineProperty(dialogPrototype, 'showModal', {
      configurable: true,
      value() {
        this.open = true;
      },
    });
  }
});

afterEach(() => {
  cleanup();
  if (!nativeShowModal) delete dialogPrototype.showModal;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('passes a generated PDF File to the device share menu', async () => {
  const share = vi.fn(async () => {});
  vi.stubGlobal('navigator', {
    userAgent: navigator.userAgent,
    share,
    canShare: ({ files }) => files[0].type === 'application/pdf',
  });
  render(<ShareScanResults report={report} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Share PDF' }));
  const [{ files }] = share.mock.calls[0];
  expect(files).toHaveLength(1);
  expect(files[0]).toBeInstanceOf(File);
  expect(files[0].name).toBe('capital-flow-scan-2026-11-03.pdf');
  expect(files[0].size).toBeGreaterThan(1000);
});

it('offers a downloadable PDF when native file sharing is unavailable', async () => {
  vi.stubGlobal('navigator', { userAgent: navigator.userAgent });
  const createObjectURL = vi.fn(() => 'blob:fixture');
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    expect(this.download).toBe('capital-flow-scan-2026-11-03.pdf');
  });
  render(<ShareScanResults report={report} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share', exact: true }));
  const save = screen.getByRole('button', { name: 'Save PDF' });
  await waitFor(() => expect(save).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Share PDF' })).not.toBeInTheDocument();
  fireEvent.click(save);
  expect(createObjectURL.mock.calls[0][0].type).toBe('application/pdf');
  expect(download).toHaveBeenCalledOnce();
});
