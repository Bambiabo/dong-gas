import type { ShiftReport } from "@/lib/terminal-store";

export const STATION_NAME = "Dong Gas";

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

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
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export function dateTime(value: string): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Not recorded";
  }

  return date.toLocaleString("en-GB", {
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

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10000);
}

/* -------------------------------------------------------------------------- */
/* Report validation                                                          */
/* -------------------------------------------------------------------------- */

function requireAmount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `${field} is missing or invalid in this saved shift. ` +
        "The report cannot safely substitute zero for an unrecorded amount."
    );
  }

  if (value < 0) {
    throw new Error(`${field} cannot be negative.`);
  }

  return value;
}

function getReportValues(report: ShiftReport) {
  if (!report.shiftId || !report.supervisor?.trim()) {
    throw new Error("The shift reference or supervisor name is missing.");
  }

  const price = requireAmount(report.price, "Fuel price");
  const openM = requireAmount(report.openM, "Opening meter");
  const closeM = requireAmount(report.closeM, "Closing meter");

  const cash = requireAmount(report.cash, "Cash");
  const momo = requireAmount(report.momo, "MoMo");
  const expenses = requireAmount(report.expenses, "Expenses");

  if (price <= 0) {
    throw new Error("Fuel price must be greater than zero.");
  }

  if (closeM <= openM) {
    throw new Error("Closing meter must be greater than opening meter.");
  }

  // Calculate the displayed totals from the recorded source amounts.
  const litres = closeM - openM;
  const expected = litres * price;
  const collections = cash + momo;
  const accounted = collections + expenses;
  const variance = accounted - expected;

  const status =
    variance < -0.005
      ? "SHORTAGE"
      : variance > 0.005
      ? "OVERAGE"
      : "BALANCED";

  const storedTotalsDiffer =
    (Number.isFinite(report.accounted) &&
      Math.abs(report.accounted - accounted) > 0.011) ||
    (Number.isFinite(report.expected) &&
      Math.abs(report.expected - expected) > 0.011) ||
    (Number.isFinite(report.variance) &&
      Math.abs(report.variance - variance) > 0.011);

  return {
    price,
    openM,
    closeM,
    cash,
    momo,
    expenses,
    litres,
    expected,
    collections,
    accounted,
    variance,
    status,
    storedTotalsDiffer,
  };
}

/* -------------------------------------------------------------------------- */
/* WhatsApp summary                                                           */
/* -------------------------------------------------------------------------- */

export function reportSummary(
  report: ShiftReport,
  synced: boolean
): string {
  const values = getReportValues(report);

  const varianceText =
    values.status === "BALANCED"
      ? ghs(0)
      : `${values.variance >= 0 ? "+" : "-"}${ghs(
          Math.abs(values.variance)
        )}`;

  return (
    `*${STATION_NAME} - Shift Closing Report*\n` +
    `Reference: ${shiftReference(report.shiftId)}\n` +
    `Supervisor: ${report.supervisor}\n` +
    `Opened: ${dateTime(report.openedAt)}\n` +
    `Closed: ${dateTime(report.closedAt)}\n` +
    `Upload: ${synced ? "Synced to Supabase" : "Pending upload"}\n\n` +
    `*METER & SALES*\n` +
    `Opening meter: ${litresText(values.openM)} L\n` +
    `Closing meter: ${litresText(values.closeM)} L\n` +
    `Litres sold: ${litresText(values.litres)} L\n` +
    `Price per litre: ${ghs(values.price)}\n` +
    `Expected sales: ${ghs(values.expected)}\n\n` +
    `*COLLECTION BREAKDOWN*\n` +
    `Cash collected: ${ghs(values.cash)}\n` +
    `MoMo collected: ${ghs(values.momo)}\n` +
    `Cash + MoMo: ${ghs(values.collections)}\n` +
    `Shift expenses: ${ghs(values.expenses)}\n` +
    `Total accounted: ${ghs(values.accounted)}\n\n` +
    `*RECONCILIATION*\n` +
    `Variance: ${varianceText}\n` +
    `Result: ${values.status}\n\n` +
    `Basis: Total accounted = cash + MoMo + expenses.\n` +
    (values.storedTotalsDiffer
      ? `Review required: stored totals differ from the recorded breakdown.\n\n`
      : "\n") +
    `PDF report prepared for sharing.`
  );
}

/* -------------------------------------------------------------------------- */
/* PDF report                                                                 */
/* -------------------------------------------------------------------------- */

export async function buildPdf(
  report: ShiftReport,
  synced: boolean
): Promise<Blob> {
  const values = getReportValues(report);
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const W = 210;
  const H = 297;
  const M = 16;
  const CW = W - M * 2;

  const reference = shiftReference(report.shiftId);

  const colors = {
    navy: [10, 17, 30] as const,
    amber: [251, 191, 36] as const,
    text: [27, 35, 48] as const,
    muted: [107, 114, 128] as const,
    line: [226, 232, 240] as const,
    pale: [247, 249, 252] as const,
  };

  let y = 0;

  doc.setProperties({
    title: `${STATION_NAME} Shift Report ${reference}`,
    subject: "Shift sales, cash, MoMo, expenses, and reconciliation",
    author: STATION_NAME,
    creator: `${STATION_NAME} Supervisor Terminal`,
    keywords: "shift, cash, MoMo, expenses, reconciliation",
  });

  const setText = (color: readonly [number, number, number]) => {
    doc.setTextColor(color[0], color[1], color[2]);
  };

  const setFill = (color: readonly [number, number, number]) => {
    doc.setFillColor(color[0], color[1], color[2]);
  };

  const header = (subtitle: string) => {
    setFill(colors.navy);
    doc.rect(0, 0, W, 39, "F");

    setFill(colors.amber);
    doc.rect(0, 39, W, 1.3, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(23);
    setText(colors.amber);
    doc.text(STATION_NAME.toUpperCase(), M, 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text(subtitle, M, 28);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(reference, W - M, 17, {
      align: "right",
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);

    doc.text(
      synced ? "SYNCED TO SUPABASE" : "PENDING UPLOAD",
      W - M,
      26,
      { align: "right" }
    );

    y = 51;
  };

  const ensureRoom = (height: number) => {
    if (y + height <= 269) return;

    doc.addPage();
    header("SHIFT REPORT - CONTINUED");
  };

  const sectionTitle = (title: string) => {
    ensureRoom(16);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setText(colors.text);
    doc.text(title.toUpperCase(), M, y);

    y += 5;
  };

  const drawRow = (
    label: string,
    value: string,
    options: {
      shaded?: boolean;
      strong?: boolean;
    } = {}
  ) => {
    doc.setFontSize(9.5);

    const labelLines = doc.splitTextToSize(label, 102);
    const valueLines = doc.splitTextToSize(value, 62);

    const height =
      Math.max(labelLines.length, valueLines.length) * 4.5 + 5;

    ensureRoom(height);

    if (options.shaded || options.strong) {
      setFill(options.strong ? [237, 242, 248] : colors.pale);
      doc.rect(M, y, CW, height, "F");
    }

    doc.setFont("helvetica", options.strong ? "bold" : "normal");
    setText(options.strong ? colors.text : colors.muted);
    doc.text(labelLines, M + 3, y + 6);

    doc.setFont("helvetica", "bold");
    setText(colors.text);
    doc.text(valueLines, W - M - 3, y + 6, {
      align: "right",
    });

    y += height;
  };

  const drawRows = (items: [string, string][]) => {
    items.forEach(([label, value], index) => {
      drawRow(label, value, {
        shaded: index % 2 === 0,
      });
    });
  };

  /* First page: financial report */
  header("SHIFT CLOSING & COLLECTION REPORT");

  sectionTitle("Shift details");

  drawRows([
    ["Supervisor", report.supervisor],
    ["Shift opened", dateTime(report.openedAt)],
    ["Shift closed", dateTime(report.closedAt)],
  ]);

  y += 9;

  sectionTitle("Meter readings and sales");

  drawRows([
    ["Opening meter", `${litresText(values.openM)} L`],
    ["Closing meter", `${litresText(values.closeM)} L`],
    ["Litres sold", `${litresText(values.litres)} L`],
    ["Fuel price per litre", ghs(values.price)],
  ]);

  drawRow("Expected sales", ghs(values.expected), {
    strong: true,
  });

  y += 9;

  sectionTitle("Money and expense breakdown");

  drawRows([
    ["Cash collected", ghs(values.cash)],
    ["MoMo collected", ghs(values.momo)],
    ["Collections subtotal: cash + MoMo", ghs(values.collections)],
    ["Shift expenses paid from takings", ghs(values.expenses)],
  ]);

  drawRow(
    "Total accounted: cash + MoMo + expenses",
    ghs(values.accounted),
    { strong: true }
  );

  y += 9;

  /* Variance panel */
  ensureRoom(25);

  const shortage = values.status === "SHORTAGE";
  const overage = values.status === "OVERAGE";

  const panelFill: readonly [number, number, number] = shortage
    ? [254, 242, 242]
    : overage
    ? [255, 251, 235]
    : [236, 253, 245];

  const panelText: readonly [number, number, number] = shortage
    ? [185, 28, 28]
    : overage
    ? [180, 83, 9]
    : [4, 120, 87];

  setFill(panelFill);
  doc.roundedRect(M, y, CW, 23, 3, 3, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setText(colors.muted);
  doc.text("VARIANCE: ACCOUNTED MINUS EXPECTED", M + 5, y + 7);

  const varianceText =
    values.status === "BALANCED"
      ? ghs(0)
      : `${values.variance >= 0 ? "+" : "-"} ${ghs(
          Math.abs(values.variance)
        )}`;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  setText(panelText);
  doc.text(varianceText, M + 5, y + 17);

  doc.setFontSize(10);
  doc.text(values.status, W - M - 5, y + 14, {
    align: "right",
  });

  y += 30;

  /* Accounting basis */
  const notes = [
    "Accounting basis: cash is the physical shift cash remaining after recorded expenses.",
    "Expenses are added back because they were paid from shift takings.",
    "Opening float, personal money, and unrelated deposits must not be included.",
  ];

  if (!synced) {
    notes.push(
      "Upload pending: this report is saved on the device; server upload has not been confirmed."
    );
  }

  if (values.storedTotalsDiffer) {
    notes.push(
      "REVIEW REQUIRED: stored summary totals differ from the source readings or amounts. " +
        "This PDF recalculates totals from the recorded meter, price, cash, MoMo, and expenses."
    );
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  const noteLines = doc.splitTextToSize(notes.join("\n"), CW);

  ensureRoom(noteLines.length * 3.8 + 3);

  setText(colors.muted);
  doc.text(noteLines, M, y, {
    lineHeightFactor: 1.3,
  });

  /* Evidence page */
  doc.addPage();
  header("METER PHOTO EVIDENCE");

  const drawEvidence = (
    title: string,
    reading: number,
    image: string | null
  ) => {
    const boxHeight = 82;

    ensureRoom(boxHeight + 22);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setText(colors.text);
    doc.text(title, M, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(colors.muted);
    doc.text(`${litresText(reading)} L`, W - M, y, {
      align: "right",
    });

    y += 5;

    setFill(colors.pale);
    doc.roundedRect(M, y, CW, boxHeight, 2, 2, "F");

    if (image) {
      try {
        const properties = doc.getImageProperties(image);

        const scale = Math.min(
          (CW - 4) / properties.width,
          (boxHeight - 4) / properties.height
        );

        const width = properties.width * scale;
        const height = properties.height * scale;

        doc.addImage(
          image,
          "JPEG",
          M + (CW - width) / 2,
          y + (boxHeight - height) / 2,
          width,
          height
        );
      } catch (error) {
        console.error(error);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        setText(colors.muted);

        doc.text(
          "The saved photo could not be embedded.",
          M + 5,
          y + 14
        );
      }
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setText(colors.muted);
      doc.text("No photo recorded.", M + 5, y + 14);
    }

    y += boxHeight + 14;
  };

  drawEvidence(
    "OPENING METER",
    values.openM,
    report.openingImage
  );

  drawEvidence(
    "CLOSING METER",
    values.closeM,
    report.closingImage
  );

  /* Footer on every page */
  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);

    doc.setDrawColor(
      colors.line[0],
      colors.line[1],
      colors.line[2]
    );

    doc.line(M, H - 17, W - M, H - 17);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText(colors.muted);

    doc.text(
      `${STATION_NAME} Supervisor Terminal`,
      M,
      H - 11
    );

    doc.text(
      `Confidential | ${page} / ${pageCount}`,
      W - M,
      H - 11,
      { align: "right" }
    );
  }

  return doc.output("blob");
}