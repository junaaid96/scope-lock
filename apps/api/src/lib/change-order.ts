import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { CertificateModel } from "@scopelock/domain";

/** Fixed document dates: the certificate bytes must not depend on when they were rendered. */
const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 72;

/** Deterministic QR for the verify URL (same input bytes every time). */
export async function qrCodePng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: "png", width: 220, margin: 1, errorCorrectionLevel: "M" });
}

function wrap(font: PDFFont, size: number, text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) > CONTENT_W && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/**
 * Deterministic change-order PDF: fixed metadata, embedded standard fonts,
 * content drawn in model order. No timestamps, ids, or randomness — the same
 * certificate model always renders the same bytes.
 */
export async function renderCertificatePdf(model: CertificateModel, qrPng: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(model.title);
  doc.setSubject("ScopeLock change order");
  doc.setCreator("ScopeLock");
  doc.setProducer("ScopeLock");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const need = (height: number): void => {
    if (y - height < BOTTOM) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };
  const drawHeading = (text: string): void => {
    need(34);
    y -= 8;
    page.drawText(text, { x: MARGIN, y, font: bold, size: 15 });
    y -= 24;
  };
  const drawLine = (text: string): void => {
    for (const chunk of wrap(regular, 10.5, text)) {
      need(16);
      page.drawText(chunk || " ", { x: MARGIN, y, font: regular, size: 10.5 });
      y -= 15;
    }
  };

  // Header block.
  page.drawText("ScopeLock — change order", { x: MARGIN, y, font: bold, size: 20 });
  y -= 30;
  for (const chunk of wrap(regular, 10.5, model.standfirst)) {
    page.drawText(chunk, { x: MARGIN, y, font: regular, size: 10.5 });
    y -= 15;
  }
  y -= 13;

  for (const section of model.sections) {
    drawHeading(section.heading);
    for (const line of section.lines) drawLine(line);
    y -= 8;
  }

  // Verification footer: checksum + QR, kept together on the last page.
  need(300);
  y -= 12;
  page.drawText("Verification", { x: MARGIN, y, font: bold, size: 15 });
  y -= 22;
  page.drawText("Package checksum (SHA-256 over the reviewed bytes):", { x: MARGIN, y, font: regular, size: 10.5 });
  y -= 16;
  for (const chunk of wrap(regular, 10.5, model.checksum)) {
    page.drawText(chunk, { x: MARGIN, y, font: regular, size: 10.5 });
    y -= 15;
  }
  y -= 6;
  page.drawText("Scan to verify, or open:", { x: MARGIN, y, font: regular, size: 10.5 });
  y -= 16;
  for (const chunk of wrap(regular, 10.5, model.verifyUrl)) {
    page.drawText(chunk, { x: MARGIN, y, font: regular, size: 10.5 });
    y -= 15;
  }
  const qr = await doc.embedPng(qrPng);
  const qrSize = 150;
  need(qrSize + 8);
  y -= qrSize;
  page.drawImage(qr, { x: MARGIN, y, width: qrSize, height: qrSize });

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
