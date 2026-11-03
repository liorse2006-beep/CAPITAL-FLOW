import React, { useId, useRef, useState } from 'react';
import './ShareScanResults.css';

export default function ShareScanResults({ report }) {
  const dialog = useRef(null);
  const preparation = useRef(null);
  const headingId = useId();
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);

  async function open() {
    const request = {};
    preparation.current = request;
    setFile(null);
    setError(null);
    dialog.current.showModal();
    try {
      const { createScanResultsPdf } = await import('../../utils/scanResultsPdf');
      if (preparation.current === request && dialog.current?.open) setFile(createScanResultsPdf(report));
    } catch {
      if (preparation.current === request && dialog.current?.open)
        setError("Couldn't prepare your PDF. Close and try again.");
    }
  }

  function download() {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const canShare = file && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] });
  async function share() {
    try {
      await navigator.share({ files: [file] });
    } catch (reason) {
      if (reason.name !== 'AbortError')
        setError("Couldn't share the file from this device. You can save the PDF below.");
    }
  }

  return (
    <>
      <button type="button" className="share-results-trigger" aria-haspopup="dialog" onClick={open}>
        Share
      </button>
      <dialog
        ref={dialog}
        className="share-results-dialog"
        aria-labelledby={headingId}
        onClose={() => {
          preparation.current = null;
        }}
      >
        <div className="share-results-heading">
          <h2 id={headingId}>Share results</h2>
          <form method="dialog">
            <button type="submit" aria-label="Close share dialog">
              ×
            </button>
          </form>
        </div>
        <p>
          {file
            ? canShare
              ? 'Choose an app from your device’s share menu, or save the PDF.'
              : 'Save the PDF to attach it from an app that accepts PDF files.'
            : error
              ? null
              : 'Preparing your PDF…'}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="share-results-actions">
          {canShare && (
            <button type="button" className="scan-btn" onClick={share}>
              Share PDF
            </button>
          )}
          <button type="button" className="share-results-trigger" disabled={!file} onClick={download}>
            Save PDF
          </button>
        </div>
      </dialog>
    </>
  );
}
