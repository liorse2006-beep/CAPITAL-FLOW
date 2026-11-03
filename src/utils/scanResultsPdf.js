import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import appLogo from '../../public/icon-192.png?inline';
import { SECTOR_ETFS } from '../constants';
import { fmt, formatPrice, formatRatio, formatSignedPercent } from './format';
import { flowLabel, sectorName } from './marketCopy';

const columns = {
  capitalFlow: [
    ['Ticker', (row) => row.symbol],
    ['Name', (row) => row.name],
    ['Market cap', (row) => (row.marketCap > 0 ? fmt(row.marketCap) : '-')],
    ['Price', (row) => formatPrice(row.price)],
    ['Change', (row) => formatSignedPercent(row.change)],
    ['RVOL', (row) => formatRatio(row.rvol > 0 ? row.rvol : row.volumeRatio)],
    ['Avg. volume', (row) => fmt(row.avgVolume)],
    ['Volume', (row) => fmt(row.volume)],
    ['Sector', (row) => sectorName(row.sector)],
  ],
  movingAverage: (label) => [
    ['Ticker', (row) => row.symbol],
    ['Name', (row) => row.name],
    ['Price', (row) => formatPrice(row.price)],
    [label, (row) => formatPrice(row.maValue)],
    ['Distance', (row) => formatSignedPercent(row.maDistance)],
  ],
  sectorMoving: [
    ['Ticker', (row) => row.symbol],
    ['Sector', (row) => sectorName(row.sector || SECTOR_ETFS.find((sector) => sector.ticker === row.symbol)?.name)],
    ['Price', (row) => formatPrice(row.price)],
    ['Change', (row) => formatSignedPercent(row.change)],
    ['Volume ratio', (row) => formatRatio(row.volRatio)],
    ['Volume', (row) => fmt(row.volume)],
    ['Activity', (row) => flowLabel(row.flow)],
  ],
};

function utcDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null;
}

function cell(value) {
  return (
    String(value ?? '-')
      .replace(/[–—−]/g, '-')
      .replace(/[\r\n\t]+/g, ' ')
      .trim() || '-'
  );
}

export function createScanResultsPdf({ type, rows, title, scanTime, dataAsOf, dataStatus, averageLabel }) {
  const isMA = type === 'movingAverage';
  const isSector = type === 'sectorMoving';
  const fields = isMA ? columns.movingAverage(averageLabel || 'Moving average') : columns[type] || columns.capitalFlow;
  const hasPreviousMatches = !isMA && !isSector && rows.some((row) => row.previousMatch);
  const lastNumericColumn = isMA ? fields.length : fields.length - 1;
  const appUrl = 'https://capitalflow.vip/' + (isMA ? 'ma' : isSector ? 'flow' : 'scanner');
  const doc = new jsPDF({
    orientation: isMA ? 'portrait' : 'landscape',
    unit: 'pt',
    format: 'a4',
    compress: true,
    putOnlyUsedFonts: true,
  });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 36;
  const right = width - margin;
  const tableWidth = right - margin;
  const titleY = 44;
  const buttonHeight = 56;
  const tapPadding = 4;
  doc.setFont('helvetica', 'bold').setFontSize(19);
  const titleLines = doc.splitTextToSize(cell(title), tableWidth - 74);
  const buttonTop = titleY + (titleLines.length - 1) * doc.getLineHeight() + 13;
  const metadataY = buttonTop + buttonHeight + 19;
  const tableTop = metadataY + 24;
  const cornerRadius = 10;
  const gold = [244, 192, 104];
  const white = [255, 255, 255];
  const muted = [204, 204, 210];
  const asOf = utcDate(dataAsOf);
  const scannedAt = utcDate(scanTime);
  const status = {
    partial: 'Partial data',
    stale: 'Delayed data',
    unavailable: 'Data unavailable',
  }[dataStatus];
  const meta = [
    rows.length + (rows.length === 1 ? ' result' : ' results'),
    asOf ? 'Market data as of ' + asOf : scannedAt && 'Scan recorded ' + scannedAt,
    status,
    hasPreviousMatches && 'Includes earlier matches',
  ].filter(Boolean);

  doc.setProperties({ title, author: 'Capital Flow', subject: 'Stock scanner results' });
  autoTable(doc, {
    head: [['#', ...fields.map(([label]) => label)]],
    body: rows.map((row, index) => [
      String(index + 1),
      ...fields.map(([label, format]) => {
        const value = cell(format(row));
        if (label !== 'Name' || !row.previousMatch) return value;
        const earlierAt = utcDate(row.quoteAsOf);
        return value + '\nEarlier match' + (earlierAt ? ' - ' + earlierAt : '');
      }),
    ]),
    tableWidth,
    margin: { top: tableTop, right: margin, bottom: 54, left: margin },
    styles: {
      font: 'helvetica',
      fontSize: 9.5,
      cellPadding: 9,
      textColor: white,
      lineColor: [43, 43, 47],
      lineWidth: { bottom: 0.35 },
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fontSize: 9,
      fillColor: [29, 29, 32],
      textColor: [235, 235, 239],
      lineColor: [153, 115, 61],
      lineWidth: { bottom: 0.65 },
    },
    bodyStyles: { fillColor: [14, 14, 16] },
    alternateRowStyles: { fillColor: [19, 19, 22] },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    didParseCell({ cell, column, section }) {
      if (column.index === 0) {
        cell.styles.halign = 'center';
        cell.styles.textColor = muted;
      }
      if (column.index >= 3 && column.index <= lastNumericColumn) cell.styles.halign = 'right';
      if (section === 'body' && column.index === 1) cell.styles.fontStyle = 'bold';
    },
    willDrawPage() {
      doc.setFillColor(0, 0, 0).rect(0, 0, width, height, 'F');
      doc.addImage(appLogo, 'PNG', right - 52, 24, 52, 52, 'capital-flow-app-icon');
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(19)
        .setTextColor(...white);
      doc.text(titleLines, margin, titleY);

      const linkLabel = 'OPEN CAPITAL FLOW';
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(11)
        .setTextColor(...gold);
      const linkWidth = 196;
      doc
        .setLineWidth(0.8)
        .setDrawColor(...gold)
        .setFillColor(27, 22, 14)
        .roundedRect(margin, buttonTop, linkWidth, buttonHeight, 6, 6, 'FD');
      doc.text(linkLabel, margin + 14, buttonTop + 24);
      // A literal, selectable URL also works as a fallback in viewers that
      // detect URLs in text but do not expose the PDF's link annotations.
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(9)
        .text(appUrl, margin + 14, buttonTop + 40);
      // jsPDF flips page Y when it serializes a link. Starting at the bottom
      // with a negative height emits the conventional [left, bottom, right,
      // top] PDF rectangle, so readers don't have to normalize its corners.
      doc.link(
        margin - tapPadding,
        buttonTop + buttonHeight + tapPadding,
        linkWidth + 2 * tapPadding,
        -(buttonHeight + 2 * tapPadding),
        { url: appUrl }
      );

      doc
        .setFont('helvetica', 'normal')
        .setFontSize(9)
        .setTextColor(...muted);
      doc.text(meta.join('  |  '), margin, metadataY);
    },
    didDrawPage({ cursor }) {
      const tableHeight = cursor.y - tableTop;
      // Extend the mask beyond the cell strokes to keep their ends inside the curve.
      const strokePadding = 0.75;
      doc.setFillColor(0, 0, 0);
      doc.rect(
        margin - strokePadding,
        tableTop - strokePadding,
        tableWidth + 2 * strokePadding,
        tableHeight + 2 * strokePadding,
        null
      );
      doc.roundedRect(margin, tableTop, tableWidth, tableHeight, cornerRadius, cornerRadius, null);
      doc.fillEvenOdd();
    },
  });
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(61, 61, 66).line(margin, height - 44, right, height - 44);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(...muted);
    doc.text(
      'Market data may be delayed or incomplete. Verify independently. For education only.',
      margin,
      height - 27
    );
    doc.text(page + ' / ' + pageCount, right, height - 27, { align: 'right' });
  }
  const date = (scannedAt || utcDate(new Date())).slice(0, 10);
  return new File(
    [doc.output('arraybuffer')],
    'capital-flow-' + (isMA ? 'moving-average' : isSector ? 'hot-sectors' : 'scan') + '-' + date + '.pdf',
    {
      type: 'application/pdf',
    }
  );
}
