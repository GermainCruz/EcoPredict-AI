import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { wrap } from '../utils/errors.js';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { renderLineChart } from '../utils/chart-png.js';

const r = Router();
r.use(authenticate);

const QUALITY_LABELS = {
  valid: 'Válido',
  suspect: 'Sospechoso',
  rejected: 'Rechazado',
};

const SOURCE_LABELS = {
  manual: 'Manual',
  demo: 'Demo',
  import: 'Importado',
  sensor: 'Sensor',
};

const fmtDate = (d) =>
  new Date(d).toLocaleString('es-PE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const fmtNum = (n) => Number(n).toFixed(3);

async function dataset(req) {
  const f = z
    .object({
      site_id: z.coerce.number().int().positive().optional(),
      variable_id: z.coerce.number().int().positive().optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      graph: z.enum(['0', '1']).default('1'),
    })
    .parse(req.query);

  const rows = (
    await query(
      `SELECT m.id, s.name AS site, v.name AS variable, v.unit,
              m.value, m.measured_at, m.source_type, m.quality_status
       FROM measurements m
       JOIN monitoring_sites s ON s.id = m.site_id
       JOIN environmental_variables v ON v.id = m.variable_id
       WHERE ($1::bigint IS NULL OR m.site_id = $1)
         AND ($2::bigint IS NULL OR m.variable_id = $2)
         AND ($3::timestamptz IS NULL OR m.measured_at >= $3)
         AND ($4::timestamptz IS NULL OR m.measured_at <= $4)
       ORDER BY m.measured_at DESC
       LIMIT 10000`,
      [f.site_id ?? null, f.variable_id ?? null, f.from ?? null, f.to ?? null]
    )
  ).rows;

  return { rows, filters: { ...f, graph: f.graph === '1' } };
}

// P2 #20: puntos para el gráfico del reporte. Si hay filtro de variable se
// grafica el promedio diario (misma unidad); en caso contrario, el conteo diario.
function buildChartPoints(rows, filters) {
  const byDay = new Map();
  for (const row of rows) {
    const day = new Date(row.measured_at).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(Number(row.value));
  }
  const days = [...byDay.keys()].sort();
  if (filters.variable_id && days.length) {
    const sample = rows[0];
    return {
      caption: `Tendencia diaria — ${sample.variable} (${sample.unit})`,
      points: days.map((d) => ({
        x: d,
        y: byDay.get(d).reduce((a, b) => a + b, 0) / byDay.get(d).length,
      })),
    };
  }
  return {
    caption: 'Registros por día',
    points: days.map((d) => ({ x: d, y: byDay.get(d).length })),
  };
}

function summarize(rows) {
  const counts = { total: rows.length, valid: 0, suspect: 0, rejected: 0 };
  const byVarMap = new Map();

  for (const row of rows) {
    if (counts[row.quality_status] !== undefined) counts[row.quality_status] += 1;
    const key = `${row.variable}__${row.unit}`;
    const val = Number(row.value);
    if (!byVarMap.has(key)) {
      byVarMap.set(key, {
        variable: row.variable,
        unit: row.unit,
        count: 0,
        sum: 0,
        min: val,
        max: val,
      });
    }
    const entry = byVarMap.get(key);
    entry.count += 1;
    entry.sum += val;
    if (val < entry.min) entry.min = val;
    if (val > entry.max) entry.max = val;
  }

  const byVariable = [...byVarMap.values()].map((v) => ({
    variable: v.variable,
    unit: v.unit,
    count: v.count,
    avg: v.sum / v.count,
    min: v.min,
    max: v.max,
  }));

  return { counts, byVariable };
}

function filterDescription(filters) {
  const parts = [];
  if (filters.site_id) parts.push(`Estación #${filters.site_id}`);
  if (filters.variable_id) parts.push(`Variable #${filters.variable_id}`);
  if (filters.from) parts.push(`Desde ${fmtDate(filters.from)}`);
  if (filters.to) parts.push(`Hasta ${fmtDate(filters.to)}`);
  return parts.length ? parts.join(' | ') : 'Todas las estaciones y variables';
}

function generatePdf(res, rows, filters, summary, chart) {
  res.type('application/pdf');
  const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
  doc.pipe(res);

  const pageWidth = doc.page.width - 72;
  const brand = '#087968';
  const dark = '#18312b';
  const muted = '#5c726a';
  const border = '#d6e2dc';

  // Header banner
  doc.rect(36, 36, pageWidth, 64).fill(brand);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('EcoPredict AI', 50, 48);
  doc.font('Helvetica').fontSize(10).text('Reporte de Monitoreo y Análisis Ambiental', 50, 71);
  doc
    .fontSize(8.5)
    .text(`Emisión: ${fmtDate(new Date())}`, 36, 52, { width: pageWidth - 14, align: 'right' });
  doc.text(`Registros: ${summary.counts.total}`, 36, 66, { width: pageWidth - 14, align: 'right' });

  // Filters line
  doc.fillColor(muted).font('Helvetica').fontSize(8.5).text(`Filtros: ${filterDescription(filters)}`, 36, 110);

  // KPI cards
  const kpis = [
    ['Total registros', String(summary.counts.total), dark],
    ['Válidos', String(summary.counts.valid), '#166b40'],
    ['Sospechosos', String(summary.counts.suspect), '#b45309'],
    ['Rechazados', String(summary.counts.rejected), '#b91c1c'],
  ];
  const cardW = (pageWidth - 24) / 4;
  kpis.forEach(([label, val, color], idx) => {
    const x = 36 + idx * (cardW + 8);
    doc.roundedRect(x, 128, cardW, 46, 6).fillAndStroke('#f6faf8', border);
    doc.fillColor(muted).font('Helvetica').fontSize(8).text(label, x + 10, 136, { width: cardW - 20 });
    doc.fillColor(color).font('Helvetica-Bold').fontSize(15).text(val, x + 10, 150, { width: cardW - 20 });
  });

  // Disclaimer box
  doc.roundedRect(36, 184, pageWidth, 30, 5).fillAndStroke('#fffbeb', '#fde68a');
  doc
    .fillColor('#92400e')
    .font('Helvetica')
    .fontSize(8)
    .text(
      'Nota técnica: Las mediciones y estimaciones estadísticas contenidas en este informe tienen fines académicos y de gestión; no equivalen a certificaciones oficiales de calidad ambiental.',
      46,
      191,
      { width: pageWidth - 20 }
    );

  let y = 226;

  // P2 #20: gráfico de tendencia embebido.
  if (chart && chart.points.length) {
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(11).text(chart.caption, 36, y);
    y += 16;
    const imgW = pageWidth;
    const imgH = Math.round(imgW * (420 / 1400));
    doc.image(chart.buffer, 36, y, { width: imgW });
    y += imgH + 18;
  }

  // Summary by variable
  if (summary.byVariable.length) {
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(11).text('Resumen estadístico por variable', 36, y);
    y += 16;
    const sumCols = [
      { label: 'Variable', w: 185, align: 'left' },
      { label: 'Unidad', w: 58, align: 'left' },
      { label: 'Muestras', w: 60, align: 'right' },
      { label: 'Promedio', w: 73, align: 'right' },
      { label: 'Mínimo', w: 73, align: 'right' },
      { label: 'Máximo', w: 74, align: 'right' },
    ];
    doc.rect(36, y, pageWidth, 20).fill('#18312b');
    let cx = 36;
    sumCols.forEach((c) => {
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(c.label, cx + 5, y + 6, {
        width: c.w - 10,
        align: c.align,
      });
      cx += c.w;
    });
    y += 20;

    summary.byVariable.forEach((v, idx) => {
      if (y > 760) {
        doc.addPage();
        y = 40;
      }
      doc.rect(36, y, pageWidth, 18).fill(idx % 2 === 0 ? '#ffffff' : '#f4f8f6');
      doc.moveTo(36, y + 18).lineTo(36 + pageWidth, y + 18).strokeColor(border).lineWidth(0.5).stroke();
      const vals = [v.variable, v.unit, String(v.count), fmtNum(v.avg), fmtNum(v.min), fmtNum(v.max)];
      cx = 36;
      sumCols.forEach((c, i) => {
        doc.fillColor(dark).font('Helvetica').fontSize(8).text(vals[i], cx + 5, y + 5, {
          width: c.w - 10,
          align: c.align,
          lineBreak: false,
          ellipsis: true,
        });
        cx += c.w;
      });
      y += 18;
    });
    y += 16;
  }

  // Detail table
  if (y > 720) {
    doc.addPage();
    y = 40;
  }
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(11).text('Detalle de mediciones', 36, y);
  y += 16;

  const cols = [
    { label: 'ID', w: 34, align: 'left' },
    { label: 'Estación', w: 120, align: 'left' },
    { label: 'Variable', w: 112, align: 'left' },
    { label: 'Valor', w: 72, align: 'right' },
    { label: 'Fecha', w: 86, align: 'left' },
    { label: 'Origen', w: 47, align: 'left' },
    { label: 'Calidad', w: 52, align: 'left' },
  ];

  const drawDetailHeader = (posY) => {
    doc.rect(36, posY, pageWidth, 20).fill(brand);
    let cx = 36;
    cols.forEach((c) => {
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(c.label, cx + 4, posY + 6, {
        width: c.w - 8,
        align: c.align,
      });
      cx += c.w;
    });
    return posY + 20;
  };

  y = drawDetailHeader(y);

  rows.forEach((row, idx) => {
    if (y > 775) {
      doc.addPage();
      y = drawDetailHeader(40);
    }
    doc.rect(36, y, pageWidth, 18).fill(idx % 2 === 0 ? '#ffffff' : '#f4f8f6');
    doc.moveTo(36, y + 18).lineTo(36 + pageWidth, y + 18).strokeColor(border).lineWidth(0.4).stroke();

    const vals = [
      String(row.id),
      row.site,
      row.variable,
      `${fmtNum(row.value)} ${row.unit}`,
      fmtDate(row.measured_at),
      SOURCE_LABELS[row.source_type] || row.source_type,
      QUALITY_LABELS[row.quality_status] || row.quality_status,
    ];
    let cx = 36;
    cols.forEach((c, i) => {
      const qColor =
        i === 6
          ? row.quality_status === 'valid'
            ? '#166b40'
            : row.quality_status === 'suspect'
              ? '#b45309'
              : '#b91c1c'
          : dark;
      doc.fillColor(qColor).font(i === 6 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).text(vals[i], cx + 4, y + 5, {
        width: c.w - 8,
        align: c.align,
        lineBreak: false,
        ellipsis: true,
      });
      cx += c.w;
    });
    y += 18;
  });

  // Page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc
      .fillColor(muted)
      .font('Helvetica')
      .fontSize(8)
      .text(`EcoPredict AI — Página ${i + 1} de ${range.count}`, 36, doc.page.height - 28, {
        width: pageWidth,
        align: 'center',
      });
  }

  doc.end();
}

async function generateXlsx(res, rows, filters, summary) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EcoPredict AI';
  wb.created = new Date();

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF087968' } };
  const darkFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18312B' } };
  const zebraFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F8F6' } };
  const thinBorder = {
    top: { style: 'thin', color: { argb: 'FFD6E2DC' } },
    left: { style: 'thin', color: { argb: 'FFD6E2DC' } },
    bottom: { style: 'thin', color: { argb: 'FFD6E2DC' } },
    right: { style: 'thin', color: { argb: 'FFD6E2DC' } },
  };

  // Sheet 1: Resumen
  const wsSum = wb.addWorksheet('Resumen');
  wsSum.mergeCells('A1:F1');
  wsSum.getCell('A1').value = 'EcoPredict AI — Reporte Ambiental';
  wsSum.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  wsSum.getCell('A1').fill = headerFill;
  wsSum.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsSum.getRow(1).height = 30;

  wsSum.getCell('A2').value = `Fecha de emisión: ${fmtDate(new Date())}`;
  wsSum.getCell('A3').value = `Filtros aplicados: ${filterDescription(filters)}`;
  wsSum.getCell('A2').font = { size: 10, color: { argb: 'FF435E55' } };
  wsSum.getCell('A3').font = { size: 10, color: { argb: 'FF435E55' } };

  wsSum.getCell('A5').value = 'Indicador';
  wsSum.getCell('B5').value = 'Cantidad';
  ['A5', 'B5'].forEach((c) => {
    wsSum.getCell(c).fill = darkFill;
    wsSum.getCell(c).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });

  const kpiRows = [
    ['Total de registros', summary.counts.total],
    ['Registros válidos', summary.counts.valid],
    ['Registros sospechosos', summary.counts.suspect],
    ['Registros rechazados', summary.counts.rejected],
  ];
  kpiRows.forEach(([label, val], idx) => {
    const rIdx = 6 + idx;
    wsSum.getCell(`A${rIdx}`).value = label;
    wsSum.getCell(`B${rIdx}`).value = val;
    wsSum.getCell(`A${rIdx}`).border = thinBorder;
    wsSum.getCell(`B${rIdx}`).border = thinBorder;
  });

  wsSum.getCell('A11').value = 'Resumen por variable';
  wsSum.getCell('A11').font = { size: 12, bold: true, color: { argb: 'FF18312B' } };

  const sumHeaders = ['Variable', 'Unidad', 'Muestras', 'Promedio', 'Mínimo', 'Máximo'];
  sumHeaders.forEach((h, i) => {
    const cell = wsSum.getRow(12).getCell(i + 1);
    cell.value = h;
    cell.fill = headerFill;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = thinBorder;
  });

  summary.byVariable.forEach((v, idx) => {
    const row = wsSum.getRow(13 + idx);
    row.values = [v.variable, v.unit, v.count, v.avg, v.min, v.max];
    [4, 5, 6].forEach((col) => {
      row.getCell(col).numFmt = '0.000';
    });
    row.eachCell((cell) => {
      cell.border = thinBorder;
      if (idx % 2 === 1) cell.fill = zebraFill;
    });
  });

  wsSum.columns = [
    { width: 28 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];

  // Sheet 2: Mediciones
  const ws = wb.addWorksheet('Mediciones');
  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = 'EcoPredict AI — Detalle de Mediciones Ambientales';
  ws.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = headerFill;
  ws.getRow(1).height = 26;

  ws.getCell('A2').value = `Emisión: ${fmtDate(new Date())} | Registros: ${rows.length}`;
  ws.getCell('A2').font = { size: 9, italic: true, color: { argb: 'FF5C726A' } };

  const headers = ['ID', 'Estación', 'Variable', 'Unidad', 'Valor', 'Fecha', 'Origen', 'Calidad'];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.fill = darkFill;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = thinBorder;
  });
  headerRow.height = 22;

  rows.forEach((x, idx) => {
    const row = ws.getRow(5 + idx);
    row.values = [
      x.id,
      x.site,
      x.variable,
      x.unit,
      Number(x.value),
      fmtDate(x.measured_at),
      SOURCE_LABELS[x.source_type] || x.source_type,
      QUALITY_LABELS[x.quality_status] || x.quality_status,
    ];
    row.getCell(5).numFmt = '0.000';
    row.eachCell((cell, colNum) => {
      cell.border = thinBorder;
      if (idx % 2 === 1) cell.fill = zebraFill;
      if (colNum === 8) {
        const argb =
          x.quality_status === 'valid'
            ? 'FF166B40'
            : x.quality_status === 'suspect'
              ? 'FFB45309'
              : 'FFB91C1C';
        cell.font = { bold: true, color: { argb } };
      }
    });
  });

  ws.columns = [
    { width: 10 },
    { width: 28 },
    { width: 26 },
    { width: 12 },
    { width: 14 },
    { width: 22 },
    { width: 14 },
    { width: 15 },
  ];
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.autoFilter = 'A4:H4';

  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
  res.end();
}

async function generateDocx(res, rows, filters, summary, chart) {
  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'D6E2DC' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D6E2DC' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'D6E2DC' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'D6E2DC' },
  };
  const cellMargins = { top: 80, bottom: 80, left: 110, right: 110 };

  const makeHeaderCell = (text) =>
    new TableCell({
      shading: { type: ShadingType.CLEAR, fill: '087968' },
      margins: cellMargins,
      borders: cellBorders,
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 19 })],
        }),
      ],
    });

  const makeBodyCell = (text, idx, align = AlignmentType.LEFT, color = '18312B', bold = false) =>
    new TableCell({
      shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: 'F4F8F6' } : undefined,
      margins: cellMargins,
      borders: cellBorders,
      children: [
        new Paragraph({
          alignment: align,
          children: [new TextRun({ text: String(text), color, bold, size: 18 })],
        }),
      ],
    });

  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: ['Variable', 'Unidad', 'Muestras', 'Promedio', 'Mínimo', 'Máximo'].map(makeHeaderCell),
      }),
      ...summary.byVariable.map(
        (v, idx) =>
          new TableRow({
            cantSplit: true,
            children: [
              makeBodyCell(v.variable, idx),
              makeBodyCell(v.unit, idx),
              makeBodyCell(v.count, idx, AlignmentType.RIGHT),
              makeBodyCell(fmtNum(v.avg), idx, AlignmentType.RIGHT),
              makeBodyCell(fmtNum(v.min), idx, AlignmentType.RIGHT),
              makeBodyCell(fmtNum(v.max), idx, AlignmentType.RIGHT),
            ],
          })
      ),
    ],
  });

  const detailRows = rows.slice(0, 1000);
  const detailTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: ['ID', 'Estación', 'Variable', 'Valor', 'Fecha', 'Calidad'].map(makeHeaderCell),
      }),
      ...detailRows.map((x, idx) => {
        const qColor =
          x.quality_status === 'valid' ? '166B40' : x.quality_status === 'suspect' ? 'B45309' : 'B91C1C';
        return new TableRow({
          cantSplit: true,
          children: [
            makeBodyCell(x.id, idx),
            makeBodyCell(x.site, idx),
            makeBodyCell(x.variable, idx),
            makeBodyCell(`${fmtNum(x.value)} ${x.unit}`, idx, AlignmentType.RIGHT),
            makeBodyCell(fmtDate(x.measured_at), idx),
            makeBodyCell(
              QUALITY_LABELS[x.quality_status] || x.quality_status,
              idx,
              AlignmentType.LEFT,
              qColor,
              true
            ),
          ],
        });
      }),
    ],
  });

  const noticeBox = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: 'FFFBEB' },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: 'FDE68A' },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: 'FDE68A' },
              right: { style: BorderStyle.SINGLE, size: 4, color: 'FDE68A' },
              left: { style: BorderStyle.SINGLE, size: 18, color: 'D97706' },
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Nota técnica: Las mediciones y estimaciones estadísticas no equivalen a certificaciones oficiales de calidad ambiental.',
                    color: '92400E',
                    size: 18,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const document = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: 'EcoPredict AI — Reporte Ambiental', color: '087968', bold: true })],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({ text: `Emisión: ${fmtDate(new Date())}  |  `, color: '5C726A', size: 20 }),
              new TextRun({
                text: `Registros: ${summary.counts.total} (Válidos: ${summary.counts.valid}, Sospechosos: ${summary.counts.suspect}, Rechazados: ${summary.counts.rejected})`,
                color: '18312B',
                bold: true,
                size: 20,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 180 },
            children: [new TextRun({ text: `Filtros: ${filterDescription(filters)}`, color: '5C726A', size: 18 })],
          }),
          noticeBox,
          ...(chart && chart.points.length
            ? [
                new Paragraph({
                  text: chart.caption,
                  heading: HeadingLevel.HEADING_2,
                  spacing: { before: 260, after: 120 },
                }),
                new Paragraph({
                  children: [new ImageRun({ type: 'png', data: chart.buffer, transformation: { width: 600, height: 180 } })],
                }),
              ]
            : []),
          ...(summary.byVariable.length
            ? [
                new Paragraph({
                  text: 'Resumen estadístico por variable',
                  heading: HeadingLevel.HEADING_2,
                  spacing: { before: 260, after: 120 },
                }),
                summaryTable,
              ]
            : []),
          new Paragraph({
            text: 'Detalle de mediciones',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 260, after: 120 },
          }),
          ...(rows.length > 1000
            ? [
                new Paragraph({
                  spacing: { after: 100 },
                  children: [
                    new TextRun({
                      text: 'El archivo Word incluye los primeros 1 000 registros; utilice Excel (.xlsx) para exportar hasta 10 000.',
                      italics: true,
                      color: '5C726A',
                      size: 18,
                    }),
                  ],
                }),
              ]
            : []),
          detailTable,
        ],
      },
    ],
  });

  res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.send(await Packer.toBuffer(document));
}

r.get(
  '/:format',
  wrap(async (req, res) => {
    const format = req.params.format;
    if (!['pdf', 'docx', 'xlsx'].includes(format)) {
      return res.status(404).json({ error: 'Formato inválido' });
    }
    const { rows, filters } = await dataset(req);
    const summary = summarize(rows);
    const date = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="ecopredict_${date}.${format}"`);

    // El gráfico vectorial solo aplica a PDF/DOCX (Excel ya es tabular).
    let chart = null;
    if (filters.graph && format !== 'xlsx') {
      const built = buildChartPoints(rows, filters);
      chart = built.points.length ? { ...built, buffer: renderLineChart(built.points) } : null;
    }

    if (format === 'pdf') return generatePdf(res, rows, filters, summary, chart);
    if (format === 'xlsx') return generateXlsx(res, rows, filters, summary);
    return generateDocx(res, rows, filters, summary, chart);
  })
);

export default r;
