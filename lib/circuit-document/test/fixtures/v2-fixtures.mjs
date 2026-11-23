import { createCircuitComponent } from "../../src/model.ts";

const pin = (componentId, pinId) => ({ componentId, pinId });
const net = (id, name, members) => ({ id, name, members });
const route = (id, netId, points) => ({ id, netId, points, properties: {} });

function makeDocument({
  id,
  title,
  components: definitions,
  nets,
  noConnects = [],
  routes = [],
  junctions = [],
  crossings = [],
}) {
  const components = definitions.map(({ id: componentId, type, properties, reference, value }) =>
    createCircuitComponent({
      id: componentId,
      type,
      ...(reference ? { reference } : {}),
      ...(value ? { value } : {}),
      properties,
    })
  );
  const assigned = new Set([
    ...nets.flatMap((item) => item.members),
    ...noConnects,
  ].map(({ componentId, pinId }) => `${componentId}\u0000${pinId}`));
  const unassignedPins = components.flatMap((component) =>
    component.pins.flatMap((componentPin) => {
      const reference = pin(component.id, componentPin.id);
      return assigned.has(`${component.id}\u0000${componentPin.id}`)
        ? []
        : [reference];
    })
  );
  const placements = components.map((component) => {
    const properties = component.properties;
    const at = Array.isArray(properties.at) ? properties.at : undefined;
    const from = Array.isArray(properties.from) ? properties.from : undefined;
    const to = Array.isArray(properties.to) ? properties.to : undefined;
    const position = at
      ? [...at]
      : from && to
        ? [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
        : [0, 0];
    return {
      componentId: component.id,
      position,
      rotation: typeof properties.rotation === "number" ? properties.rotation : 0,
      flip: properties.flip === true,
      legacyGeometry: {
        ...(from ? { from: [...from] } : {}),
        ...(to ? { to: [...to] } : {}),
        ...(at ? { at: [...at] } : {}),
      },
      properties: {},
    };
  });

  return {
    schemaVersion: 2,
    id,
    title,
    electrical: { components, nets, noConnects, unassignedPins },
    drawing: {
      units: "px",
      canvas: { width: 640, height: 480 },
      placements,
      routes,
      junctions,
      crossings,
      annotations: [],
    },
  };
}

const seriesLed = makeDocument({
  id: "fixture-series-led",
  title: "Series LED",
  components: [
    { id: "B1", type: "battery", value: "9V", properties: { from: [40, 100], to: [40, 150] } },
    { id: "SW1", type: "switch", properties: { from: [100, 100], to: [150, 100] } },
    { id: "R1", type: "resistor", value: "330 ohm", properties: { from: [210, 100], to: [270, 100] } },
    { id: "D1", type: "led", value: "red", properties: { from: [330, 100], to: [370, 100] } },
  ],
  nets: [
    net("supply", "VCC", [pin("B1", "+"), pin("SW1", "1")]),
    net("switched", "SW_OUT", [pin("SW1", "2"), pin("R1", "1")]),
    net("led-feed", "LED_FEED", [pin("R1", "2"), pin("D1", "A")]),
    net("return", "GND", [pin("D1", "K"), pin("B1", "-")]),
  ],
  routes: [
    route("W1", "supply", [[40, 100], [100, 100]]),
    route("W2", "switched", [[150, 100], [210, 100]]),
    route("W3", "led-feed", [[270, 100], [330, 100]]),
    route("W4", "return", [[370, 100], [400, 100], [400, 220], [40, 220], [40, 150]]),
  ],
});

const parallelBranches = makeDocument({
  id: "fixture-parallel-branches",
  title: "Parallel LED branches",
  components: [
    { id: "B1", type: "battery", value: "9V", properties: { from: [40, 80], to: [40, 300] } },
    { id: "R1", type: "resistor", value: "330 ohm", properties: { from: [150, 110], to: [150, 150] } },
    { id: "D1", type: "led", value: "red", properties: { from: [150, 180], to: [150, 210] } },
    { id: "R2", type: "resistor", value: "330 ohm", properties: { from: [300, 110], to: [300, 150] } },
    { id: "D2", type: "led", value: "green", properties: { from: [300, 180], to: [300, 210] } },
  ],
  nets: [
    net("positive", "VCC", [pin("B1", "+"), pin("R1", "1"), pin("R2", "1")]),
    net("negative", "GND", [pin("B1", "-"), pin("D1", "K"), pin("D2", "K")]),
    net("branch-1", "LED_1", [pin("R1", "2"), pin("D1", "A")]),
    net("branch-2", "LED_2", [pin("R2", "2"), pin("D2", "A")]),
  ],
  routes: [
    route("P_RAIL", "positive", [[40, 80], [300, 80]]),
    route("P_R1", "positive", [[150, 80], [150, 110]]),
    route("P_R2", "positive", [[300, 80], [300, 110]]),
    route("N_RAIL", "negative", [[40, 300], [300, 300]]),
    route("N_D1", "negative", [[150, 210], [150, 300]]),
    route("N_D2", "negative", [[300, 210], [300, 300]]),
    route("B1_D1", "branch-1", [[150, 150], [150, 180]]),
    route("B2_D2", "branch-2", [[300, 150], [300, 180]]),
  ],
  junctions: [
    { id: "J_POS1", at: [150, 80], routeIds: ["P_RAIL", "P_R1"], properties: {} },
    { id: "J_POS2", at: [300, 80], routeIds: ["P_RAIL", "P_R2"], properties: {} },
    { id: "J_NEG1", at: [150, 300], routeIds: ["N_RAIL", "N_D1"], properties: {} },
    { id: "J_NEG2", at: [300, 300], routeIds: ["N_RAIL", "N_D2"], properties: {} },
  ],
});

const singleTransistorSwitch = makeDocument({
  id: "fixture-single-transistor-switch",
  title: "Single transistor switch",
  components: [
    { id: "V1", type: "dcsource", value: "9V", properties: { from: [70, 50], to: [70, 100] } },
    { id: "Q1", type: "npn", value: "2N3904", properties: { at: [300, 200] } },
    { id: "R_INPUT", type: "resistor", value: "10 kohm", properties: { from: [120, 200], to: [220, 200] } },
    { id: "R_PULLDOWN", type: "resistor", value: "100 kohm", properties: { from: [220, 260], to: [220, 340] } },
    { id: "GND1", type: "ground", properties: { at: [300, 350] } },
  ],
  nets: [
    net("control", "CONTROL", [pin("R_INPUT", "2"), pin("Q1", "B"), pin("R_PULLDOWN", "1")]),
    net("return", "GND", [pin("Q1", "E"), pin("R_PULLDOWN", "2"), pin("GND1", "at"), pin("V1", "-")]),
    net("supply", "VCC", [pin("V1", "+")]),
  ],
});

const astableFlasher = makeDocument({
  id: "fixture-astable-flasher",
  title: "Two-transistor astable flasher",
  components: [
    { id: "Q1", type: "npn", value: "2N3904", properties: { at: [200, 220] } },
    { id: "Q2", type: "npn", value: "2N3904", properties: { at: [440, 220], flip: true } },
    { id: "C1", type: "electrolytic", value: "10 uF", properties: { from: [260, 120], to: [260, 180] } },
    { id: "C2", type: "electrolytic", value: "10 uF", properties: { from: [380, 120], to: [380, 180] } },
    { id: "R1", type: "resistor", value: "10 kohm", properties: { from: [130, 70], to: [130, 130] } },
    { id: "R2", type: "resistor", value: "10 kohm", properties: { from: [510, 70], to: [510, 130] } },
  ],
  nets: [
    net("emitters", "GND", [pin("Q1", "E"), pin("Q2", "E")]),
    net("collector-1", "COLLECTOR_1", [pin("Q1", "C"), pin("C1", "+")]),
    net("base-2", "BASE_2", [pin("Q2", "B"), pin("C1", "-"), pin("R2", "2")]),
    net("collector-2", "COLLECTOR_2", [pin("Q2", "C"), pin("C2", "+")]),
    net("base-1", "BASE_1", [pin("Q1", "B"), pin("C2", "-"), pin("R1", "2")]),
  ],
});

const astableBaseShort = makeDocument({
  id: "fixture-astable-base-short",
  title: "Astable with explicit base short",
  components: [
    { id: "Q1", type: "npn", properties: { at: [200, 220] } },
    { id: "Q2", type: "npn", properties: { at: [440, 220] } },
  ],
  nets: [
    net("base-short", "BASES", [pin("Q1", "B"), pin("Q2", "B")]),
  ],
});

const separateCrossingNets = makeDocument({
  id: "fixture-separate-crossing-nets",
  title: "Separate nets crossing without connection",
  components: [
    { id: "B_HL", type: "battery", properties: { from: [0, 50], to: [0, 70] } },
    { id: "B_HR", type: "battery", properties: { from: [100, 50], to: [100, 70] } },
    { id: "B_VT", type: "battery", properties: { from: [50, 0], to: [70, 0] } },
    { id: "B_VB", type: "battery", properties: { from: [50, 100], to: [70, 100] } },
  ],
  nets: [
    net("horizontal", "CROSS", [pin("B_HL", "+"), pin("B_HR", "+")]),
    net("vertical", "CROSS", [pin("B_VT", "+"), pin("B_VB", "+")]),
  ],
  routes: [
    route("W_H", "horizontal", [[0, 50], [100, 50]]),
    route("W_V", "vertical", [[50, 0], [50, 100]]),
  ],
  crossings: [
    { id: "BR1", at: [50, 50], orientation: "horizontal", routeIds: ["W_H", "W_V"], properties: {} },
  ],
});

const sharedBranch = makeDocument({
  id: "fixture-shared-net-branch",
  title: "Three pins on one branch net",
  components: [
    { id: "V1", type: "dcsource", properties: { from: [40, 80], to: [40, 150] } },
    { id: "R1", type: "resistor", properties: { from: [140, 80], to: [140, 130] } },
    { id: "R2", type: "resistor", properties: { from: [260, 80], to: [260, 130] } },
  ],
  nets: [
    net("branch", "VCC", [pin("V1", "+"), pin("R1", "1"), pin("R2", "1")]),
  ],
  routes: [
    route("R_MAIN", "branch", [[40, 80], [260, 80]]),
    route("R_TAP_1", "branch", [[140, 80], [140, 100]]),
    route("R_TAP_2", "branch", [[260, 80], [260, 100]]),
  ],
  junctions: [
    { id: "J1", at: [140, 80], routeIds: ["R_MAIN", "R_TAP_1"], properties: {} },
    { id: "J2", at: [260, 80], routeIds: ["R_MAIN", "R_TAP_2"], properties: {} },
  ],
});

const separateGrounds = makeDocument({
  id: "fixture-separate-ground-nets",
  title: "Separate ground references",
  components: [
    { id: "GND_A", type: "ground", properties: { at: [100, 100] } },
    { id: "GND_D", type: "ground", properties: { at: [300, 100] } },
  ],
  nets: [
    net("analog-ground", "GND", [pin("GND_A", "at")]),
    net("digital-ground", "GND", [pin("GND_D", "at")]),
  ],
});

const sharedGround = makeDocument({
  id: "fixture-shared-ground-net",
  title: "Explicit shared ground net",
  components: [
    { id: "GND_A", type: "ground", properties: { at: [100, 100] } },
    { id: "GND_D", type: "ground", properties: { at: [300, 100] } },
  ],
  nets: [
    net("shared-ground", "GND", [pin("GND_A", "at"), pin("GND_D", "at")]),
  ],
});

const duplicateNames = makeDocument({
  id: "fixture-duplicate-net-names",
  title: "Names do not merge nets",
  components: [
    { id: "D1", type: "led", properties: { from: [80, 100], to: [110, 100] } },
    { id: "D2", type: "led", properties: { from: [280, 100], to: [310, 100] } },
  ],
  nets: [
    net("signal-a", "SIGNAL", [pin("D1", "A")]),
    net("signal-b", "SIGNAL", [pin("D2", "A")]),
  ],
});

const intentionalNoConnect = makeDocument({
  id: "fixture-intentional-no-connect",
  title: "Explicit no-connect marker",
  components: [
    { id: "D1", type: "led", properties: { from: [80, 100], to: [110, 100] } },
  ],
  nets: [],
  noConnects: [pin("D1", "A")],
});

const dcsource = makeDocument({
  id: "fixture-dcsource",
  title: "Distinct DC source type",
  components: [
    { id: "V1", type: "dcsource", value: "9V", properties: { from: [100, 50], to: [100, 110] } },
  ],
  nets: [
    net("positive", "V+", [pin("V1", "+")]),
  ],
});

const duplicateKicadPins = {
  id: "Test:DuplicatePins",
  units: [{
    unit: 1,
    bodyStyle: 1,
    pins: [
      { number: "1", name: "GND", electricalType: "power_in", shape: "line", point: [-30, 0], bodyPoint: [-12, 0], showName: true, showNumber: true },
      { number: "1", name: "GND", electricalType: "power_in", shape: "line", point: [-30, 20], bodyPoint: [-12, 20], showName: true, showNumber: true },
      { number: "3", name: "OUT", electricalType: "output", shape: "line", point: [30, 0], bodyPoint: [12, 0], showName: true, showNumber: true },
    ],
    graphics: [],
  }],
};

const kicadSymbol = makeDocument({
  id: "fixture-kicad-symbol",
  title: "KiCad symbol with repeated pin definition",
  components: [
    {
      id: "U1",
      type: "kicad",
      reference: "U1",
      value: "Synthetic catalog fixture",
      properties: {
        symbolId: "Test:DuplicatePins",
        at: [300, 200],
        unit: 1,
        bodyStyle: 1,
        symbolData: duplicateKicadPins,
      },
    },
  ],
  nets: [],
});

const farApartSameNet = makeDocument({
  id: "fixture-far-apart-same-net",
  title: "Electrical membership is independent of coordinates",
  components: [
    { id: "D1", type: "led", properties: { from: [10, 20], to: [30, 20] } },
    { id: "D2", type: "led", properties: { from: [500, 400], to: [520, 400] } },
  ],
  nets: [
    net("same-net", "REMOTE_MEMBERS", [pin("D1", "A"), pin("D2", "A")]),
  ],
});

const differentNetJunctionConflict = makeDocument({
  id: "fixture-conflicting-junction",
  title: "Visual junction cannot merge two net IDs",
  components: [
    { id: "B_HL", type: "battery", properties: { from: [0, 50], to: [0, 70] } },
    { id: "B_HR", type: "battery", properties: { from: [100, 50], to: [100, 70] } },
    { id: "B_VT", type: "battery", properties: { from: [50, 0], to: [70, 0] } },
    { id: "B_VB", type: "battery", properties: { from: [50, 100], to: [70, 100] } },
  ],
  nets: [
    net("horizontal", "CROSS", [pin("B_HL", "+"), pin("B_HR", "+")]),
    net("vertical", "CROSS", [pin("B_VT", "+"), pin("B_VB", "+")]),
  ],
  routes: [
    route("W_H", "horizontal", [[0, 50], [100, 50]]),
    route("W_V", "vertical", [[50, 0], [50, 100]]),
  ],
  junctions: [
    { id: "J_BAD", at: [50, 50], routeIds: ["W_H", "W_V"], properties: {} },
  ],
});

export const circuitDocumentFixtures = [
  { name: "series LED", purpose: "Preserve four explicit nets through a source, switch, resistor, and LED.", document: seriesLed },
  { name: "parallel branches", purpose: "Keep two load branches on shared supply and return nets.", document: parallelBranches },
  { name: "single-transistor switch", purpose: "Represent a base control, emitter return, and pull-down explicitly.", document: singleTransistorSwitch },
  { name: "astable flasher", purpose: "Keep the two transistor bases on separate cross-coupled nets.", document: astableFlasher },
  { name: "astable base short", purpose: "Represent a base-to-base fault as explicit shared net membership.", document: astableBaseShort },
  { name: "separate crossing nets", purpose: "Keep crossing routes electrically separate unless the net IDs match.", document: separateCrossingNets },
  { name: "shared branch net", purpose: "Place three pin references on one named supply net.", document: sharedBranch },
  { name: "separate ground nets", purpose: "Keep analog and digital ground references separate in v2.", document: separateGrounds },
  { name: "shared ground net", purpose: "Connect two ground symbols only through an explicitly shared net ID.", document: sharedGround },
  { name: "duplicate display names", purpose: "Show that repeated names do not merge distinct net IDs.", document: duplicateNames },
  { name: "intentional no-connect", purpose: "Distinguish an explicit no-connect from unknown pin state.", document: intentionalNoConnect },
  { name: "unassigned pin", purpose: "Keep a pin with unknown connectivity as an explicit unassigned reference.", document: makeDocument({
    id: "fixture-unassigned-pin",
    title: "Unassigned pin remains unknown",
    components: [{ id: "R1", type: "resistor", properties: { from: [100, 100], to: [160, 100] } }],
    nets: [],
  }) },
  { name: "dcsource", purpose: "Retain dcsource as its own supported type with plus and minus pin identities.", document: dcsource },
  { name: "KiCad duplicate pins", purpose: "Derive identities from the selected symbol unit and preserve repeated pin definitions.", document: kicadSymbol },
  { name: "far-apart same-net pins", purpose: "Prove electrical connectivity is not inferred from component coordinates.", document: farApartSameNet },
  { name: "conflicting visual junction", purpose: "Reject a junction annotation that touches routes from different net IDs.", document: differentNetJunctionConflict, expectedValid: false },
];

export const ambiguousLegacyFixture = {
  purpose: "An unresolved KiCad symbol must block legacy conversion instead of inventing pin identities.",
  spec: {
    title: "Unresolved KiCad symbol",
    elements: [{
      type: "kicad",
      id: "U_UNKNOWN",
      symbolId: "Unknown:Part",
      at: [120, 120],
    }],
  },
};

export { makeDocument, net, pin, route };
