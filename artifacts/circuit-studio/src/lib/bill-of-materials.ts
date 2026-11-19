export type CircuitElementForBom = {
  type: string;
  id?: string;
  label?: string;
  value?: string;
  [key: string]: unknown;
};

export type BomMetadataField =
  | "technicalName"
  | "manufacturer"
  | "mpn"
  | "package"
  | "footprint"
  | "specifications"
  | "notes";

export type BomOverrides = Record<string, Partial<Record<BomMetadataField, string>>>;

export type BomRow = {
  key: string;
  elementKeys: string[];
  references: string[];
  missingReferenceCount: number;
  quantity: number;
  commonName: string;
  technicalName: string;
  value: string;
  manufacturer: string;
  mpn: string;
  package: string;
  footprint: string;
  specifications: string;
  notes: string;
};

const COMPONENT_NAMES: Record<string, { commonName: string; technicalName: string }> = {
  resistor: { commonName: "Resistor", technicalName: "Fixed resistor" },
  capacitor: { commonName: "Capacitor", technicalName: "Capacitor, polarity unspecified" },
  electrolytic: {
    commonName: "Electrolytic capacitor",
    technicalName: "Polarized electrolytic capacitor",
  },
  inductor: { commonName: "Inductor / coil", technicalName: "Inductor" },
  diode: { commonName: "Diode", technicalName: "Semiconductor diode, type unspecified" },
  zener: { commonName: "Zener diode", technicalName: "Zener diode" },
  led: { commonName: "LED", technicalName: "Light-emitting diode" },
  battery: { commonName: "Battery", technicalName: "DC battery / cell, chemistry unspecified" },
  switch: { commonName: "Switch", technicalName: "Electrical switch, contact type unspecified" },
  mic: { commonName: "Microphone", technicalName: "Microphone capsule, type unspecified" },
  speaker: { commonName: "Speaker", technicalName: "Loudspeaker" },
  lamp: { commonName: "Lamp", technicalName: "Electrical lamp" },
  acsource: { commonName: "AC source", technicalName: "Alternating-current source" },
  crystal: { commonName: "Crystal", technicalName: "Crystal resonator, type unspecified" },
  npn: { commonName: "NPN transistor", technicalName: "NPN bipolar junction transistor (BJT)" },
  pnp: { commonName: "PNP transistor", technicalName: "PNP bipolar junction transistor (BJT)" },
  opamp: { commonName: "Op-amp", technicalName: "Operational amplifier" },
  antenna: { commonName: "Antenna", technicalName: "Wire antenna" },
};

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sourceText(element: CircuitElementForBom, ...fields: string[]): string {
  for (const field of fields) {
    const value = textValue(element[field]);
    if (value) return value;
  }
  return "";
}

function sourceSpecifications(element: CircuitElementForBom): string {
  const direct = sourceText(element, "specifications", "specs");
  if (direct) return direct;
  return [
    ["Tolerance", sourceText(element, "tolerance")],
    ["Voltage rating", sourceText(element, "voltageRating", "voltage_rating")],
    ["Power rating", sourceText(element, "powerRating", "power_rating")],
    ["Current rating", sourceText(element, "currentRating", "current_rating")],
    ["Frequency", sourceText(element, "frequencyRange", "frequency")],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("; ");
}

export function bomElementKey(element: CircuitElementForBom, index: number): string {
  const reference = textValue(element.label) || textValue(element.id);
  const value = textValue(element.value);
  return reference
    ? `${reference}|${element.type}|${value}`
    : `unassigned|${element.type}|${value}|${index}`;
}

export function buildBomRows(
  elements: CircuitElementForBom[],
  overrides: BomOverrides,
): BomRow[] {
  const groups = new Map<string, BomRow>();

  elements.forEach((element, index) => {
    const names = COMPONENT_NAMES[element.type];
    if (!names) return;

    const elementKey = bomElementKey(element, index);
    const override = overrides[elementKey] ?? {};
    const technicalName =
      override.technicalName || sourceText(element, "technicalName") || names.technicalName;
    const manufacturer = override.manufacturer ?? sourceText(element, "manufacturer");
    const mpn = override.mpn ?? sourceText(element, "mpn", "partNumber", "part_number");
    const packageName = override.package ?? sourceText(element, "package", "packageName");
    const footprint = override.footprint ?? sourceText(element, "footprint", "edaFootprint");
    const specifications =
      override.specifications ?? sourceSpecifications(element);
    const notes = override.notes ?? sourceText(element, "notes", "description");
    const value = textValue(element.value);
    const identity = JSON.stringify([
      element.type,
      value,
      technicalName,
      manufacturer,
      mpn,
      packageName,
      footprint,
      specifications,
      notes,
    ]);

    let row = groups.get(identity);
    if (!row) {
      row = {
        key: "",
        elementKeys: [],
        references: [],
        missingReferenceCount: 0,
        quantity: 0,
        commonName: names.commonName,
        technicalName,
        value,
        manufacturer,
        mpn,
        package: packageName,
        footprint,
        specifications,
        notes,
      };
      groups.set(identity, row);
    }

    row.elementKeys.push(elementKey);
    row.quantity += 1;
    const reference = textValue(element.label) || textValue(element.id);
    if (reference) row.references.push(reference);
    else row.missingReferenceCount += 1;
  });

  return [...groups.values()]
    .map((row) => ({ ...row, key: row.elementKeys.join("::") }))
    .sort((a, b) =>
      (a.references[0] || "~").localeCompare(b.references[0] || "~", undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function buildBomCsv(rows: BomRow[]): string {
  const header = [
    "Reference designators",
    "Unassigned references",
    "Quantity",
    "Common name",
    "Technical name",
    "Value / rating",
    "Manufacturer",
    "MPN / part number",
    "Package",
    "Footprint",
    "Specifications",
    "Notes",
  ];
  const lines = [
    header,
    ...rows.map((row) => [
      row.references.join(", ") || "Not assigned",
      row.missingReferenceCount,
      row.quantity,
      row.commonName,
      row.technicalName,
      row.value || "Not specified",
      row.manufacturer || "Not specified",
      row.mpn || "Not specified",
      row.package || "Not specified",
      row.footprint || "Not specified",
      row.specifications || "Not specified",
      row.notes || "",
    ]),
  ];
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlValue(value: string): string {
  return value ? escapeHtml(value) : "Not specified";
}

export function buildTechnicalDocumentHtml({
  title,
  schematicSvg,
  rows,
  buildSheet,
  designIntent,
  createdAt,
}: {
  title: string;
  schematicSvg: string;
  rows: BomRow[];
  buildSheet: string;
  designIntent?: string;
  createdAt: string;
}): string {
  const bomRows = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.references.join(", ") || "Not assigned")}${row.missingReferenceCount ? `<small>${row.missingReferenceCount} reference${row.missingReferenceCount === 1 ? "" : "s"} needed</small>` : ""}</td>
        <td>${row.quantity}</td>
        <td>${escapeHtml(row.commonName)}</td>
        <td>${htmlValue(row.technicalName)}</td>
        <td>${htmlValue(row.value)}</td>
        <td>${htmlValue(row.manufacturer)}</td>
        <td>${htmlValue(row.mpn)}</td>
        <td>${htmlValue(row.package)}</td>
        <td>${htmlValue(row.footprint)}</td>
        <td>${htmlValue(row.specifications)}</td>
        <td>${htmlValue(row.notes)}</td>
      </tr>`,
    )
    .join("");
  const intentSection = designIntent?.trim()
    ? `<section><h2>Design intent</h2><p>${escapeHtml(designIntent.trim())}</p></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Technical document</title>
  <style>
    :root { color-scheme: light; font: 14px/1.55 Arial, sans-serif; color: #1f302c; }
    body { max-width: 1200px; margin: 0 auto; padding: 36px; }
    header { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; border-bottom:2px solid #1c6b55; padding-bottom:18px; }
    h1 { margin:0; font-size:28px; letter-spacing:-.04em; }
    h2 { margin:28px 0 12px; font-size:18px; }
    .meta { color:#61736b; font-size:12px; text-align:right; }
    .schematic { margin-top:20px; padding:18px; border:1px solid #d9ded6; background:#fff; }
    .schematic svg { display:block; width:100%; height:auto; max-height:640px; }
    table { width:100%; border-collapse:collapse; font-size:11px; }
    th,td { padding:7px 8px; border:1px solid #d9ded6; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
    th { background:#eef3ee; font-weight:700; }
    td small { display:block; color:#9a5d3f; margin-top:3px; }
    .notice { margin-top:14px; padding:11px 13px; background:#f8f3e9; border-left:3px solid #c07a50; color:#5e5142; font-size:12px; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; padding:14px; background:#f5f6f2; border:1px solid #e0e3dc; font:11px/1.5 ui-monospace,monospace; }
    .print-action { position:fixed; right:22px; top:18px; padding:9px 13px; border:0; border-radius:5px; background:#176b55; color:white; font-weight:700; cursor:pointer; }
    @page { size:A4 landscape; margin:12mm; }
    @media print {
      body { max-width:none; padding:0; font-size:10px; }
      .print-action { display:none; }
      header { break-after:avoid; }
      .schematic { break-inside:avoid; }
      table { font-size:8px; }
      thead { display:table-header-group; }
      tr { break-inside:avoid; }
      th,td { padding:4px 5px; }
      pre { font-size:8px; }
    }
  </style>
</head>
<body>
  <button class="print-action" onclick="window.print()">Print / Save as PDF</button>
  <header>
    <div><h1>${escapeHtml(title)}</h1><div>Technical document · Circuit Studio</div></div>
    <div class="meta">Prepared ${escapeHtml(createdAt)}<br>Parts and netlist reflect the current drawing.</div>
  </header>
  ${intentSection}
  <section><h2>Schematic</h2><div class="schematic">${schematicSvg}</div></section>
  <section>
    <h2>Bill of materials</h2>
    <table>
      <thead><tr><th>References</th><th>Qty</th><th>Common name</th><th>Technical name</th><th>Value / rating</th><th>Manufacturer</th><th>MPN / part number</th><th>Package</th><th>Footprint</th><th>Specifications</th><th>Notes</th></tr></thead>
      <tbody>${bomRows}</tbody>
    </table>
    <div class="notice">Values marked “Not specified” were not present in the drawing. Confirm exact manufacturer part numbers, electrical ratings, package, footprint, and reference designators against component datasheets before ordering or building.</div>
  </section>
  <section><h2>EDA build sheet and netlist</h2><pre>${escapeHtml(buildSheet)}</pre></section>
  <section>
    <h2>Engineering review notes</h2>
    <div class="notice">Circuit Studio checks drawing structure only. This document is not a validated design, simulation, electrical safety review, or compliance approval. Verify pinouts, ratings, connectivity, and PCB footprints in your EDA tool before fabrication or use.</div>
  </section>
</body>
</html>`;
}
