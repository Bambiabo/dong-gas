import type { ShiftReport } from "@/lib/terminal-store";

export const STATION_NAME = "Dong Gas";

export function ghs(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function litresText(value: number): string {
  return value.toLocaleString("en-GH", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

export function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "Not recorded";
}

export function shiftReference(id: string): string {
  return `DG-${id.slice(0, 8).toUpperCase()}`;
}

export function reportFilename(report: ShiftReport): string {
  return `Dong-Gas-${shiftReference(report.shiftId)}.pdf`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function requireAmount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} is missing or invalid.`);
  }
  return value;
}

function getReportValues(report: ShiftReport) {
  if (!report.shiftId || !report.supervisor?.trim()) throw new Error("Shift reference or supervisor name is missing.");
  const price = requireAmount(report.price, "Fuel price");
  const openM = requireAmount(report.openM, "Opening meter");
  const closeM = requireAmount(report.closeM, "Closing meter");
  const cash = requireAmount(report.cash, "Cash");
  const momo = requireAmount(report.momo, "MoMo");
  const expenses = requireAmount(report.expenses, "Expenses");
  if (price <= 0) throw new Error("Fuel price must be greater than zero.");
  if (closeM <= openM) throw new Error("Closing meter must be greater than opening meter.");
  const litres = closeM - openM;
  const expected = litres * price;
  const collections = cash + momo;
  const accounted = collections + expenses;
  const variance = accounted - expected;
  const status = variance < -0.005 ? "SHORTAGE" : variance > 0.005 ? "OVERAGE" : "BALANCED";
  return { price, openM, closeM, cash, momo, expenses, litres, expected, collections, accounted, variance, status };
}

export function reportSummary(report: ShiftReport, synced: boolean): string {
  const v = getReportValues(report);
  const variance = v.status === "BALANCED" ? ghs(0) : `${v.variance >= 0 ? "+" : "-"}${ghs(Math.abs(v.variance))}`;
  return `*${STATION_NAME} - Shift Closing Report*\nReference: ${shiftReference(report.shiftId)}\nSupervisor: ${report.supervisor}\nOpened: ${dateTime(report.openedAt)}\nClosed: ${dateTime(report.closedAt)}\nUpload: ${synced ? "Synced" : "Pending upload"}\n\n*METER & SALES*\nOpening: ${litresText(v.openM)} L\nClosing: ${litresText(v.closeM)} L\nLitres sold: ${litresText(v.litres)} L\nPrice: ${ghs(v.price)}\nExpected sales: ${ghs(v.expected)}\n\n*COLLECTIONS*\nCash: ${ghs(v.cash)}\nMoMo: ${ghs(v.momo)}\nExpenses: ${ghs(v.expenses)}\nAccounted: ${ghs(v.accounted)}\n\n*RECONCILIATION*\nVariance: ${variance}\nResult: ${v.status}`;
}

export async function buildPdf(report: ShiftReport, synced: boolean): Promise<Blob> {
  const v = getReportValues(report);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = 210, H = 297, M = 14, CW = W - M * 2;
  const reference = shiftReference(report.shiftId);
  const navy = [15, 23, 42] as const;
  const amber = [245, 158, 11] as const;
  const text = [30, 41, 59] as const;
  const muted = [100, 116, 139] as const;
  const line = [226, 232, 240] as const;
  const pale = [248, 250, 252] as const;

  const setColor = (c: readonly [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const setFill = (c: readonly [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  let y = 0;

  const header = (subtitle: string) => {
    setFill(navy);
    doc.rect(0, 0, W, 36, "F");
    setFill(amber);
    doc.rect(0, 36, W, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    setColor(amber);
    doc.text(STATION_NAME.toUpperCase(), M, 17);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text(subtitle, M, 27);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(reference, W - M, 17, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    doc.text(synced ? "SYNCED TO SUPABASE" : "PENDING UPLOAD", W - M, 27, { align: "right" });
    y = 48;
  };

  const ensure = (h: number) => {
    if (y + h <= 270) return;
    doc.addPage();
    header("SHIFT REPORT - CONTINUED");
  };

  const title = (label: string) => {
    ensure(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(text);
    doc.text(label.toUpperCase(), M, y);
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.line(M, y + 2, W - M, y + 2);
    y += 8;
  };

  const row = (label: string, value: string, strong = false) => {
    ensure(9);
    doc.setFont("helvetica", strong ? "bold" : "normal");
    doc.setFontSize(10);
    setColor(muted);
    doc.text(label, M + 2, y + 5);
    doc.setFont("helvetica", "bold");
    setColor(text);
    doc.text(value, W - M - 2, y + 5, { align: "right" });
    y += 8;
  };

  const rows = (items: [string, string][], strongLast = false) => {
    items.forEach(([label, value], index) => row(label, value, strongLast && index === items.length - 1));
  };

  const kpi = (label: string, value: string, color: readonly [number, number, number]) => {
    const width = (CW - 8) / 3;
    setFill(pale);
    doc.roundedRect(M, y, width, 22, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(muted);
    doc.text(label, M + 4, y + 7);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    setColor(color);
    doc.text(value, M + 4, y + 16);
  };

  header("SHIFT CLOSING & COLLECTION REPORT");

  title("Shift summary");
  kpi("LITRES SOLD", `${litresText(v.litres)} L`, text);
  kpi("EXPECTED SALES", ghs(v.expected), text);
  const varianceColor = v.status === "SHORTAGE" ? [220, 38, 38] as const : v.status === "OVERAGE" ? [217, 119, 6] as const : [5, 150, 105] as const;
  kpi("VARIANCE", v.status === "BALANCED" ? ghs(0) : `${v.variance >= 0 ? "+" : "-"}${ghs(Math.abs(v.variance))}`, varianceColor);
  y += 30;

  title("Shift details");
  rows([["Supervisor", report.supervisor], ["Shift opened", dateTime(report.openedAt)], ["Shift closed", dateTime(report.closedAt)], ["Upload status", synced ? "Synced to Supabase" : "Pending upload"]]);
  y += 6;

  title("Meter readings and sales");
  rows([["Opening meter", `${litresText(v.openM)} L`], ["Closing meter", `${litresText(v.closeM)} L`], ["Litres sold", `${litresText(v.litres)} L`], ["Fuel price per litre", ghs(v.price)], ["Expected sales", ghs(v.expected)]], true);
  y += 6;

  title("Collections and expenses");
  rows([["Cash collected", ghs(v.cash)], ["MoMo collected", ghs(v.momo)], ["Cash + MoMo", ghs(v.collections)], ["Shift expenses", ghs(v.expenses)], ["Total accounted", ghs(v.accounted)]], true);
  y += 8;

  ensure(28);
  const fill = v.status === "SHORTAGE" ? [254, 242, 242] as const : v.status === "OVERAGE" ? [255, 251, 235] as const : [236, 253, 245] as const;
  setFill(fill);
  doc.roundedRect(M, y, CW, 24, 3, 3, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(muted);
  doc.text("VARIANCE: ACCOUNTED MINUS EXPECTED", M + 5, y + 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  setColor(varianceColor);
  doc.text(v.status === "BALANCED" ? ghs(0) : `${v.variance >= 0 ? "+" : "-"} ${ghs(Math.abs(v.variance))}`, M + 5, y + 18);
  doc.setFontSize(11);
  doc.text(v.status, W - M - 5, y + 16, { align: "right" });
  y += 32;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(muted);
  const notes = doc.splitTextToSize("Accounting basis: Total accounted = cash + MoMo + expenses paid from shift takings. Opening float and personal money are excluded." + (synced ? "" : " Upload pending: server upload has not been confirmed."), CW);
  ensure(notes.length * 4 + 4);
  doc.text(notes, M, y);

  doc.addPage();
  header("METER PHOTO EVIDENCE");
  const boxW = (CW - 6) / 2;
  const boxH = 75;
  const evidence = (label: string, reading: number, image: string | null, x: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(text);
    doc.text(label, x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setColor(muted);
    doc.text(`${litresText(reading)} L`, x + boxW, y, { align: "right" });
    setFill(pale);
    doc.roundedRect(x, y + 4, boxW, boxH, 2, 2, "F");
    if (image) {
      try {
        const props = doc.getImageProperties(image);
        const scale = Math.min((boxW - 4) / props.width, (boxH - 4) / props.height);
        const width = props.width * scale;
        const height = props.height * scale;
        doc.addImage(image, "JPEG", x + (boxW - width) / 2, y + 4 + (boxH - height) / 2, width, height);
      } catch {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        setColor(muted);
        doc.text("Photo unavailable", x + 4, y + 16);
      }
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      setColor(muted);
      doc.text("No photo recorded", x + 4, y + 16);
    }
  };
  evidence("OPENING METER", v.openM, report.openingImage, M);
  evidence("CLOSING METER", v.closeM, report.closingImage, M + boxW + 6);

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.line(M, H - 16, W - M, H - 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(muted);
    doc.text(`${STATION_NAME} Supervisor Terminal`, M, H - 10);
    doc.text(`Confidential | ${page} / ${pages}`, W - M, H - 10, { align: "right" });
  }

  return doc.output("blob");
}
