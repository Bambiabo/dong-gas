import type { ShiftReport } from "./terminal-store";

export const STATION_NAME = "Dong Gas";

export function ghs(v: number): string {
  return "GHS " + v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function litresText(value: number): string {
  return value.toLocaleString("en-GH", {
    maximumFractionDigits: 3,
  });
}

export function dateTime(value: string | number | Date): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function shiftReference(id: string): string {
  return `DG-${id.slice(0, 8).toUpperCase()}`;
}

export function reportFilename(r: ShiftReport): string {
  return `Dong-Gas-${shiftReference(r.shiftId)}.pdf`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function reportSummary(r: ShiftReport, synced: boolean): string {
  return `*${STATION_NAME} — Shift Report*\nReference: ${shiftReference(r.shiftId)}\nStatus: ${synced ? "Synced" : "Pending"}\nSupervisor: ${r.supervisor}\nLitres: ${litresText(r.litres)} L\nExpected: ${ghs(r.expected)}\nAccounted: ${ghs(r.accounted)}\nVariance: ${r.variance >= 0 ? "+" : "-"}${ghs(Math.abs(r.variance))}`;
}

export async function buildPdf(r: ShiftReport, synced: boolean): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(STATION_NAME, 16, 20);
  doc.setFontSize(10);
  doc.text(`Shift Report - ${shiftReference(r.shiftId)}`, 16, 28);
  doc.text(`Supervisor: ${r.supervisor}`, 16, 36);
  doc.text(`Litres Sold: ${litresText(r.litres)} L`, 16, 44);
  doc.text(`Expected Sales: ${ghs(r.expected)}`, 16, 52);
  doc.text(`Total Accounted: ${ghs(r.accounted)}`, 16, 60);
  doc.text(`Variance: ${ghs(r.variance)}`, 16, 68);
  return doc.output("blob");
}