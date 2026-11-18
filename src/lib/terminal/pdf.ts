Set-Content -Path "src\lib\terminal-pdf.ts" -Value 'import type { ShiftReport } from "@/lib/terminal-store";

export const STATION_NAME = "Dong Gas";

export function ghs(value: number): string {
  return (
    "GHS " +
    value.toLocaleString("en-GH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function litresText(value: number): string {
  return value.toLocaleString("en-GH", {
    maximumFractionDigits: 3,
  });
}

export function dateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function shiftReference(id: string): string {
  return `DG-${id.slice(0, 8).toUpperCase()}`;
}

export function reportFilename(report: ShiftReport): string {
  return `Dong-Gas-${shiftReference(report.shiftId)}.pdf`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function reportSummary(
  report: ShiftReport,
  synced: boolean
): string {
  return (
    `*${STATION_NAME} — Shift Report*\n` +
    `Reference: ${shiftReference(report.shiftId)}\n` +
    `Upload status: ${synced ? "Synced to Supabase" : "Pending upload"}\n` +
    `Supervisor: ${report.supervisor}\n` +
    `Closed: ${dateTime(report.closedAt)}\n\n` +
    `Litres sold: ${report.litres.toFixed(3)} L\n` +
    `Fuel price: ${ghs(report.price)} / L\n` +
    `Expected sales: ${ghs(report.expected)}\n` +
    `Cash: ${ghs(report.cash)}\n` +
    `MoMo: ${ghs(report.momo)}\n` +
    `Expenses: ${ghs(report.expenses)}\n` +
    `Total accounted: ${ghs(report.accounted)}\n` +
    `Variance: ${report.variance >= 0 ? "+" : "-"}${ghs(
      Math.abs(report.variance)
    )}\n\n` +
    `PDF report prepared for sharing.`
  );
}

export async function buildPdf(
  report: ShiftReport,
  synced: boolean
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const W = 210;
  const M = 16;
  const contentW = W - M * 2;

  let y = 0;

  const header = (subtitle: string) => {
    doc.setFillColor(10, 16, 28);
    doc.rect(0, 0, W, 37, "F");

    doc.setFillColor(251, 191, 36);
    doc.rect(0, 37, W, 1.4, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(21);
    doc.setTextColor(251, 191, 36);
    doc.text(STATION_NAME.toUpperCase(), M, 17);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(205, 210, 220);
    doc.text(subtitle, M, 26);

    doc.text(shiftReference(report.shiftId), W - M, 17, {
      align: "right",
    });
  };

  const sectionTitle = (title: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(25, 30, 40);
    doc.text(title, M, y);
    y += 5;
  };

  const rows = (items: [string, string][]) => {
    items.forEach(([label, value], index) => {
      doc.setFontSize(9);

      const left = doc.splitTextToSize(label, 88);
      const right = doc.splitTextToSize(value, 74);
      const height = Math.max(left.length, right.length) * 4.2 + 5;

      if (y + height > 263) {
        doc.addPage();
        header("SHIFT REPORT — CONTINUED");
        y = 50;
      }

      if (index % 2 === 0) {
        doc.setFillColor(245, 246, 250);
        doc.rect(M, y, contentW, height, "F");
      }

      doc.setFont("helvetica", "normal");
      doc.setTextColor(95, 100, 115);
      doc.text(left, M + 3, y + 6);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(25, 30, 40);
      doc.text(right, W - M - 3, y + 6, {
        align: "right",
      });

      y += height;
    });
  };

  header("SHIFT CLOSING REPORT");

  y = 50;
  sectionTitle("Shift details");

  rows([
    ["Upload status", synced ? "Synced to Supabase" : "Pending upload"],
    ["Supervisor", report.supervisor],
    ["Opened", dateTime(report.openedAt)],
    ["Closed", dateTime(report.closedAt)],
    ["Fuel price per litre", ghs(report.price)],
    ["Opening meter", `${litresText(report.openM)} L`],
    ["Closing meter", `${litresText(report.closeM)} L`],
    ["Litres sold", `${litresText(report.litres)} L`],
    ["Expected sales", ghs(report.expected)],
  ]);

  y += 10;
  sectionTitle("Collections");

  rows([
    ["Cash collected", ghs(report.cash)],
    ["MoMo collected", ghs(report.momo)],
    ["Shift expenses", ghs(report.expenses)],
    ["Total accounted: cash + MoMo + expenses", ghs(report.accounted)],
  ]);

  y += 10;

  if (y + 24 > 263) {
    doc.addPage();
    header("SHIFT RECONCILIATION");
    y = 50;
  }

  const short = report.variance < -0.005;
  const over = report.variance > 0.005;

  if (short) doc.setFillColor(254, 226, 226);
  else if (over) doc.setFillColor(254, 243, 199);
  else doc.setFillColor(209, 250, 229);

  doc.roundedRect(M, y, contentW, 23, 3, 3, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(75, 80, 90);
  doc.text("VARIANCE", M + 5, y + 7);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);

  if (short) doc.setTextColor(185, 28, 28);
  else if (over) doc.setTextColor(180, 83, 9);
  else doc.setTextColor(4, 120, 87);

  doc.text(
    `${report.variance >= 0 ? "+" : "-"} ${ghs(
      Math.abs(report.variance)
    )}`,
    M + 5,
    y + 17
  );

  doc.setFontSize(10);
  doc.text(
    short ? "SHORTAGE" : over ? "OVERAGE" : "BALANCED",
    W - M - 5,
    y + 13,
    { align: "right" }
  );

  doc.addPage();
  header("METER PHOTO EVIDENCE");

  y = 50;
  sectionTitle("Opening meter");

  const drawPhoto = (
    image: string | null,
    top: number,
    height: number
  ) => {
    doc.setFillColor(245, 246, 250);
    doc.roundedRect(M, top, contentW, height, 2, 2, "F");

    if (!image) return;

    try {
      const properties = doc.getImageProperties(image);
      const scale = Math.min(
        contentW / properties.width,
        height / properties.height
      );

      const width = properties.width * scale;
      const renderedHeight = properties.height * scale;

      doc.addImage(
        image,
        "JPEG",
        M + (contentW - width) / 2,
        top + (height - renderedHeight) / 2,
        width,
        renderedHeight
      );
    } catch (error) {
      console.error(error);
      doc.setFontSize(9);
      doc.setTextColor(110, 115, 125);
      doc.text("Photo could not be embedded.", M + 5, top + 12);
    }
  };

  drawPhoto(report.openingImage, y, 85);

  y += 100;
  sectionTitle("Closing meter");
  drawPhoto(report.closingImage, y, 85);

  const pages = doc.getNumberOfPages();

  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);

    doc.setDrawColor(220, 222, 230);
    doc.line(M, 280, W - M, 280);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 125, 140);

    doc.text(`${STATION_NAME} Supervisor Terminal`, M, 285);

    doc.text(`Confidential | ${page} / ${pages}`, W - M, 285, {
      align: "right",
    });
  }

  return doc.output("blob");
}'