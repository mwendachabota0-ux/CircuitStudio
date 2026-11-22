import {
  STUDIO_LIBRARY_RESEARCH,
  type StudioLibraryResearchEntry,
} from "./generatedStudioLibraryResource.js";

export type CircuitPoint = [number, number];
export type CircuitPin = { name: string; point: CircuitPoint };
export type CircuitElementGeometry = {
  type?: unknown;
  label?: unknown;
  value?: unknown;
  from?: unknown;
  to?: unknown;
  at?: unknown;
  flip?: unknown;
  swap?: unknown;
  circle?: unknown;
  height?: unknown;
  pins?: unknown;
  labelAt?: unknown;
  labelPos?: unknown;
  labelNudge?: unknown;
  labelAnchor?: unknown;
  symbolId?: unknown;
  unit?: unknown;
  bodyStyle?: unknown;
  rotation?: unknown;
  symbolData?: unknown;
};

export type KicadSymbolGraphic = {
  type: 'polyline' | 'rectangle' | 'circle' | 'arc' | 'bezier' | 'text';
  points?: CircuitPoint[];
  radius?: number;
  text?: string;
  fontSize?: number;
  strokeWidth?: number;
  fillType?: 'none' | 'background' | 'outline';
  closed?: boolean;
};

export type KicadSymbolPin = {
  number: string;
  name: string;
  electricalType: string;
  shape: string;
  point: CircuitPoint;
  bodyPoint: CircuitPoint;
  showName: boolean;
  showNumber: boolean;
};

export type KicadSymbolUnit = {
  unit: number;
  bodyStyle: number;
  pins: KicadSymbolPin[];
  graphics: KicadSymbolGraphic[];
};

export type KicadSymbolData = {
  id: string;
  units: KicadSymbolUnit[];
};

const TWO_TERMINAL_PIN_NAMES = {
  resistor: ['1', '2'],
  capacitor: ['1', '2'],
  electrolytic: ['+', '-'],
  inductor: ['1', '2'],
  diode: ['A', 'K'],
  zener: ['A', 'K'],
  led: ['A', 'K'],
  battery: ['+', '-'],
  switch: ['1', '2'],
  mic: ['1', '2'],
  speaker: ['1', '2'],
  lamp: ['1', '2'],
  acsource: ['1', '2'],
  crystal: ['1', '2'],
  fuse: ['1', '2'],
  thermistor: ['1', '2'],
  photoresistor: ['1', '2'],
  varistor: ['1', '2'],
  photodiode: ['A', 'K'],
  schottky: ['A', 'K'],
  dcsource: ['+', '-'],
  currentsource: ['+', '-'],
  motor: ['1', '2'],
  buzzer: ['1', '2'],
  solarcell: ['+', '-'],
} as const satisfies Record<string, readonly [string, string]>;

const TRANSISTOR_PIN_OFFSETS = {
  npn: {
    B: [-25, 0],
    C: [25, -44],
    E: [25, 44],
  },
  pnp: {
    B: [-25, 0],
    E: [25, -44],
    C: [25, 44],
  },
} as const;

const FIELD_EFFECT_PIN_OFFSETS = {
  nmos: { G: [-40, 0], D: [20, -40], S: [20, 40] },
  pmos: { G: [-40, 0], D: [20, -40], S: [20, 40] },
  mosfet: { G: [-40, 0], D: [20, -40], S: [20, 40] },
  njfet: { G: [-40, 0], D: [20, -40], S: [20, 40] },
  pjfet: { G: [-40, 0], D: [20, -40], S: [20, 40] },
} as const;

const SINGLE_PIN_TYPES = new Set(['ground', 'antenna', 'terminal']);

export type CircuitComponentReferenceEntry = {
  type: string;
  requiredProperties: readonly string[];
  optionalProperties: readonly string[];
  pinCount: number | null;
  pinNames: string;
  pinPositions: string;
  connectionRules: string;
  validation: string;
  autoFix: string;
  minimumTerminalDistance?: number;
};

const COMMON_PART_OPTIONAL_PROPERTIES = [
  'id',
  'label',
  'value',
  'labelPos',
  'labelNudge',
  'labelAt',
  'labelAnchor',
] as const;

/**
 * The compatibility contract shared by CircuitDraw, AI prompts, and server
 * input validation. Keep this list aligned with the renderer's actual symbols.
 */
export const CIRCUIT_COMPONENT_REFERENCE = [
  { type: 'resistor', requiredProperties: ['from', 'to'], optionalProperties: [...COMMON_PART_OPTIONAL_PROPERTIES, 'style'], pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 50 },
  { type: 'capacitor', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 12 },
  { type: 'electrolytic', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '+, -', pinPositions: '+ is exactly at from; - is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 12 },
  { type: 'inductor', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 64 },
  { type: 'diode', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: 'A, K', pinPositions: 'A (anode) is exactly at from; K (cathode) is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 20 },
  { type: 'zener', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: 'A, K', pinPositions: 'A (anode) is exactly at from; K (cathode) is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 20 },
  { type: 'led', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: 'A, K', pinPositions: 'A (anode) is exactly at from; K (cathode) is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 20 },
  { type: 'battery', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '+, -', pinPositions: '+ is exactly at from; - is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 10 },
  { type: 'switch', requiredProperties: ['from', 'to'], optionalProperties: [...COMMON_PART_OPTIONAL_PROPERTIES, 'closed'], pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; closed controls the drawn blade only.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 36 },
  { type: 'mic', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 36 },
  { type: 'speaker', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 24 },
  { type: 'lamp', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 28 },
  { type: 'acsource', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 32 },
  { type: 'crystal', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 18 },
  { type: 'fuse', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; a symbol is not a current rating.', validation: 'Rendered and structurally validated; fuse sizing is not checked.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 46 },
  { type: 'thermistor', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated; temperature response is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 50 },
  { type: 'photoresistor', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated; light response is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 50 },
  { type: 'varistor', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated; surge protection ratings are not checked.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 50 },
  { type: 'photodiode', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: 'A, K', pinPositions: 'A (anode) is exactly at from; K (cathode) is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; optical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 20 },
  { type: 'schottky', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: 'A, K', pinPositions: 'A (anode) is exactly at from; K (cathode) is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; forward drop and current ratings are not checked.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 24 },
  { type: 'dcsource', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '+, -', pinPositions: '+ is exactly at from; - is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; source limits are not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 42 },
  { type: 'currentsource', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '+, -', pinPositions: '+ is exactly at from; - is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; source limits are not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 42 },
  { type: 'motor', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity and load are not inferred.', validation: 'Rendered and structurally validated; motor behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 44 },
  { type: 'buzzer', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated; drive requirements are not checked.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 44 },
  { type: 'solarcell', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '+, -', pinPositions: '+ is exactly at from; - is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; light response is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.', minimumTerminalDistance: 44 },
  { type: 'npn', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'flip', 'circle', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'B, C, E', pinPositions: 'B=(x-25,y), C=(x+25,y-44), E=(x+25,y+44); flip:true mirrors x offsets.', connectionRules: 'Wire endpoints must land on the calculated pin coordinates.', validation: 'Rendered and structurally validated; no general transistor electrical simulation.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'pnp', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'flip', 'circle', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'B, E, C', pinPositions: 'B=(x-25,y), E=(x+25,y-44), C=(x+25,y+44); flip:true mirrors x offsets.', connectionRules: 'Wire endpoints must land on the calculated pin coordinates.', validation: 'Rendered and structurally validated; no general transistor electrical simulation.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'opamp', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'swap', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'INV, NONINV, OUT', pinPositions: 'INV=(x-40,y-20), NONINV=(x-40,y+20), OUT=(x+40,y); swap:true exchanges input y offsets.', connectionRules: 'Generic three-pin symbol only; no IC supply pins are modeled.', validation: 'Rendered and structurally validated; no amplifier electrical simulation.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'ground', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 1, pinNames: 'at', pinPositions: 'The only pin is exactly at at.', connectionRules: 'Connect a wire endpoint or a wire segment to at.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'antenna', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'height', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 1, pinNames: 'at', pinPositions: 'The only pin is exactly at at; height changes the drawn mast, not the pin.', connectionRules: 'Connect a wire endpoint or a wire segment to at.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'terminal', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 1, pinNames: 'at', pinPositions: 'The only pin is exactly at at.', connectionRules: 'Connect a wire endpoint or a wire segment to at.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'potentiometer', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'A, W, B', pinPositions: 'A=(x-44,y), W=(x,y-52), B=(x+44,y).', connectionRules: 'The wiper is W; do not treat the symbol as a two-terminal resistor.', validation: 'Rendered and structurally validated; resistance and wiper position are not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'nmos', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'flip', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'G, D, S', pinPositions: 'G=(x-40,y), D=(x+20,y-40), S=(x+20,y+40); flip:true mirrors x offsets.', connectionRules: 'Wire endpoints must land on the calculated gate, drain, or source coordinate.', validation: 'Rendered and structurally validated; MOSFET behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'pmos', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'flip', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'G, D, S', pinPositions: 'G=(x-40,y), D=(x+20,y-40), S=(x+20,y+40); flip:true mirrors x offsets.', connectionRules: 'Wire endpoints must land on the calculated gate, drain, or source coordinate.', validation: 'Rendered and structurally validated; MOSFET behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'mosfet', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'channel', 'flip', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'G, D, S', pinPositions: 'G=(x-40,y), D=(x+20,y-40), S=(x+20,y+40); flip:true mirrors x offsets.', connectionRules: 'Wire endpoints must land on the calculated gate, drain, or source coordinate. Set channel to "n" or "p" when known.', validation: 'Rendered and structurally validated; MOSFET behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'njfet', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'flip', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'G, D, S', pinPositions: 'G=(x-40,y), D=(x+20,y-40), S=(x+20,y+40); flip:true mirrors x offsets.', connectionRules: 'Wire endpoints must land on the calculated gate, drain, or source coordinate.', validation: 'Rendered and structurally validated; JFET behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'pjfet', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'flip', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'G, D, S', pinPositions: 'G=(x-40,y), D=(x+20,y-40), S=(x+20,y+40); flip:true mirrors x offsets.', connectionRules: 'Wire endpoints must land on the calculated gate, drain, or source coordinate.', validation: 'Rendered and structurally validated; JFET behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'regulator', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'IN, GND, OUT', pinPositions: 'IN=(x-50,y), GND=(x,y+50), OUT=(x+50,y).', connectionRules: 'Connect only to the pin names shown; electrical ratings are not inferred.', validation: 'Rendered and structurally validated; regulation and thermal behavior are not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'comparator', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'swap', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'INV, NONINV, OUT', pinPositions: 'INV=(x-40,y-20), NONINV=(x-40,y+20), OUT=(x+40,y); swap:true exchanges input y offsets.', connectionRules: 'Generic three-pin symbol only; supply pins are not modeled.', validation: 'Rendered and structurally validated; comparator behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'transformer', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 4, pinNames: 'P1, P2, S1, S2', pinPositions: 'P1=(x-50,y-30), P2=(x-50,y+30), S1=(x+50,y-30), S2=(x+50,y+30).', connectionRules: 'Primary and secondary are isolated symbol sides; the drawing does not specify ratings or certify isolation.', validation: 'Rendered and structurally validated; voltage ratio and insulation are not simulated or verified.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'relay', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 5, pinNames: 'COIL1, COIL2, COM, NC, NO', pinPositions: 'COIL1=(x-55,y-20), COIL2=(x-55,y+20), COM=(x+55,y), NC=(x+55,y-30), NO=(x+55,y+30).', connectionRules: 'Coil and contact pins are distinct; the default contact sketch is normally open.', validation: 'Rendered and structurally validated; coil ratings and switching behavior are not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'bridge', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 4, pinNames: 'AC1, AC2, POS, NEG', pinPositions: 'AC1=(x-50,y-30), AC2=(x-50,y+30), POS=(x+50,y-30), NEG=(x+50,y+30).', connectionRules: 'Use AC1/AC2 for the input pair and POS/NEG for the DC pair.', validation: 'Rendered and structurally validated; voltage and current ratings are not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'opto', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 4, pinNames: 'IN+, IN-, OUT, EMIT', pinPositions: 'IN+=(x-50,y-20), IN-=(x-50,y+20), OUT=(x+50,y-20), EMIT=(x+50,y+20).', connectionRules: 'Input and output pins are shown on separate sides; the symbol is not a safety or isolation certification.', validation: 'Rendered and structurally validated; transfer behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'ic', requiredProperties: ['at', 'pins'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: null, pinNames: 'Named pins with an explicit side ("left" or "right").', pinPositions: 'Each side is spaced vertically at 24 px around at; left pins are at x-64 and right pins at x+64.', connectionRules: 'Provide real pin names and sides from a datasheet or a known pinout; never guess a part-specific pinout.', validation: 'Rendered and structurally validated; internal IC behavior and pinout correctness are not checked.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'connector', requiredProperties: ['at', 'pins'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: null, pinNames: 'Named pins with an explicit side ("left" or "right").', pinPositions: 'Each side is spaced vertically at 24 px around at; left pins are at x-64 and right pins at x+64.', connectionRules: 'Use a unique pin name for each connector contact.', validation: 'Rendered and structurally validated; connector mechanical details are not modeled.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'kicad', requiredProperties: ['symbolId', 'at'], optionalProperties: ['id', 'label', 'value', 'unit', 'bodyStyle', 'rotation', 'flip', 'symbolData', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: null, pinNames: 'Exact KiCad pin numbers and names from the imported source symbol.', pinPositions: 'Pin endpoints are derived from the selected library symbol, unit, and rotation.', connectionRules: 'Use the exact symbol ID and pin offsets supplied by the library. Do not invent a pinout.', validation: 'The source symbol drawing and structural connections are checked; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px.' },
  { type: 'wire', requiredProperties: ['points'], optionalProperties: ['id', 'label', 'open'], pinCount: null, pinNames: 'Not a component; endpoints are points[0] and points[last].', pinPositions: 'Every points entry is a route coordinate.', connectionRules: 'Use two or more points; route orthogonally; endpoints connect exactly. Crossings alone do not connect; use a junction for an explicit crossing connection. Set open:true only for an intentionally open wire.', validation: 'Rendered and structurally validated; disconnected endpoints and component overlaps are blocking errors.', autoFix: 'Only unique endpoint snaps within 8 px and limited eligible rail-tail trimming.' },
  { type: 'junction', requiredProperties: ['x', 'y'], optionalProperties: ['id', 'label'], pinCount: 1, pinNames: 'junction', pinPositions: 'The junction is at (x,y).', connectionRules: 'Place exactly on the wire intersection or wire endpoint that should connect.', validation: 'Rendered and structurally validated.', autoFix: 'No junction relocation or topology repair.' },
  { type: 'crossing', requiredProperties: ['at'], optionalProperties: ['id', 'orientation'], pinCount: 0, pinNames: 'None; drawing annotation only.', pinPositions: 'Place at the exact interior intersection of one horizontal and one vertical wire segment. orientation selects which wire is drawn as the bridge; defaults to horizontal.', connectionRules: 'This bridge marker keeps the two crossing wires electrically separate. Use a junction instead when they should connect.', validation: 'Rendered and structurally validated; crossing geometry is checked.', autoFix: 'No crossing relocation or topology repair.' },
  { type: 'label', requiredProperties: ['at', 'text'], optionalProperties: ['id', 'anchor', 'size', 'bold', 'muted'], pinCount: 0, pinNames: 'None.', pinPositions: 'Not an electrical connection.', connectionRules: 'Text annotation only; it does not connect nets.', validation: 'Rendered and structurally validated.', autoFix: 'No label repair.' },
  { type: 'box', requiredProperties: ['x', 'y', 'w', 'h'], optionalProperties: ['id', 'label', 'value'], pinCount: 0, pinNames: 'None.', pinPositions: 'Not an electrical connection.', connectionRules: 'Drawing annotation only; it does not connect nets.', validation: 'Rendered and structurally validated.', autoFix: 'No box repair.' },
] as const satisfies readonly CircuitComponentReferenceEntry[];

export type SupportedCircuitElementType =
  (typeof CIRCUIT_COMPONENT_REFERENCE)[number]['type'];

export const CIRCUIT_SUPPORTED_ELEMENT_TYPES = CIRCUIT_COMPONENT_REFERENCE.map(
  ({ type }) => type,
) as SupportedCircuitElementType[];

export type CircuitComponentCategory =
  | 'Passives'
  | 'Semiconductors'
  | 'Power'
  | 'Protection'
  | 'Control'
  | 'Input / output'
  | 'Connectors'
  | 'Drawing';

type CircuitComponentLibraryMetadata = {
  displayName: string;
  category: CircuitComponentCategory;
  description: string;
};

const COMPONENT_LIBRARY_METADATA = {
  resistor: { displayName: 'Resistor', category: 'Passives', description: 'Limits current or sets a voltage divider.' },
  capacitor: { displayName: 'Capacitor', category: 'Passives', description: 'General non-polarized capacitor.' },
  electrolytic: { displayName: 'Electrolytic capacitor', category: 'Passives', description: 'Polarized capacitor; + and − follow pin order.' },
  inductor: { displayName: 'Inductor', category: 'Passives', description: 'Coil for filtering, timing, or energy storage.' },
  diode: { displayName: 'Diode', category: 'Semiconductors', description: 'General two-terminal diode.' },
  zener: { displayName: 'Zener diode', category: 'Semiconductors', description: 'Reverse-breakdown diode symbol.' },
  led: { displayName: 'LED', category: 'Semiconductors', description: 'Light-emitting diode.' },
  battery: { displayName: 'Battery', category: 'Power', description: 'DC battery or cell with positive and negative pins.' },
  switch: { displayName: 'Switch', category: 'Control', description: 'Two-terminal open or closed switch.' },
  mic: { displayName: 'Microphone', category: 'Input / output', description: 'Two-terminal microphone symbol.' },
  speaker: { displayName: 'Speaker', category: 'Input / output', description: 'Two-terminal loudspeaker.' },
  lamp: { displayName: 'Lamp', category: 'Input / output', description: 'Two-terminal lamp or indicator.' },
  acsource: { displayName: 'AC source', category: 'Power', description: 'Generic alternating-current source; ratings are not checked.' },
  crystal: { displayName: 'Crystal', category: 'Passives', description: 'Two-terminal crystal resonator.' },
  fuse: { displayName: 'Fuse', category: 'Protection', description: 'Inline fuse symbol; protection rating is not verified.' },
  thermistor: { displayName: 'Thermistor', category: 'Passives', description: 'Temperature-dependent resistor symbol.' },
  photoresistor: { displayName: 'Photoresistor', category: 'Passives', description: 'Light-dependent resistor symbol.' },
  varistor: { displayName: 'Varistor', category: 'Protection', description: 'Voltage-dependent resistor; surge rating is not checked.' },
  photodiode: { displayName: 'Photodiode', category: 'Semiconductors', description: 'Light-sensitive diode with anode and cathode.' },
  schottky: { displayName: 'Schottky diode', category: 'Semiconductors', description: 'Schottky barrier diode symbol.' },
  dcsource: { displayName: 'DC voltage source', category: 'Power', description: 'Generic DC voltage source with + and − pins.' },
  currentsource: { displayName: 'Current source', category: 'Power', description: 'Generic current source; output limits are not simulated.' },
  motor: { displayName: 'DC motor', category: 'Input / output', description: 'Two-terminal motor or inductive load.' },
  buzzer: { displayName: 'Buzzer', category: 'Input / output', description: 'Two-terminal audible indicator.' },
  solarcell: { displayName: 'Solar cell', category: 'Power', description: 'Light-powered DC source symbol.' },
  npn: { displayName: 'NPN transistor', category: 'Semiconductors', description: 'Bipolar transistor with base, collector, and emitter pins.' },
  pnp: { displayName: 'PNP transistor', category: 'Semiconductors', description: 'Bipolar transistor with base, emitter, and collector pins.' },
  opamp: { displayName: 'Op-amp', category: 'Semiconductors', description: 'Generic three-pin amplifier symbol; supply pins are not modeled.' },
  ground: { displayName: 'Ground', category: 'Power', description: 'Single-pin ground reference.' },
  antenna: { displayName: 'Antenna', category: 'Input / output', description: 'Single-pin antenna connection.' },
  terminal: { displayName: 'Terminal', category: 'Connectors', description: 'Named single-pin net or test point.' },
  potentiometer: { displayName: 'Potentiometer', category: 'Passives', description: 'Three-pin adjustable resistor with A, W, and B pins.' },
  nmos: { displayName: 'N-channel MOSFET', category: 'Semiconductors', description: 'Three-pin insulated-gate transistor; behavior is not simulated.' },
  pmos: { displayName: 'P-channel MOSFET', category: 'Semiconductors', description: 'Three-pin insulated-gate transistor; behavior is not simulated.' },
  mosfet: { displayName: 'MOSFET', category: 'Semiconductors', description: 'Generic three-pin field-effect transistor; specify channel polarity when known.' },
  njfet: { displayName: 'N-channel JFET', category: 'Semiconductors', description: 'Three-pin junction FET symbol.' },
  pjfet: { displayName: 'P-channel JFET', category: 'Semiconductors', description: 'Three-pin junction FET symbol.' },
  regulator: { displayName: 'Voltage regulator', category: 'Power', description: 'Generic input, ground, and output regulator block.' },
  comparator: { displayName: 'Comparator', category: 'Semiconductors', description: 'Generic three-pin comparator; supply pins are not modeled.' },
  transformer: { displayName: 'Transformer', category: 'Power', description: 'Generic isolated primary and secondary symbol; ratings and safety are not verified.' },
  relay: { displayName: 'Relay', category: 'Control', description: 'Two coil pins and COM, NC, and NO contacts.' },
  bridge: { displayName: 'Bridge rectifier', category: 'Power', description: 'Four-pin AC-to-DC bridge symbol; ratings are not checked.' },
  opto: { displayName: 'Optocoupler', category: 'Semiconductors', description: 'Four-pin optical input/output symbol; isolation certification is not implied.' },
  ic: { displayName: 'Integrated circuit', category: 'Semiconductors', description: 'Flexible block with named pins; provide a verified pinout.' },
  connector: { displayName: 'Connector', category: 'Connectors', description: 'Flexible connector block with named pins.' },
  kicad: { displayName: 'KiCad library symbol', category: 'Semiconductors', description: 'Imported KiCad symbol with its source drawing and pin geometry.' },
  wire: { displayName: 'Wire', category: 'Drawing', description: 'Orthogonal route between exact pin coordinates.' },
  junction: { displayName: 'Junction', category: 'Drawing', description: 'Explicit connection point for crossing wires.' },
  crossing: { displayName: 'Wire crossing bridge', category: 'Drawing', description: 'Bridge mark shows two crossing wires that remain electrically separate.' },
  label: { displayName: 'Text label', category: 'Drawing', description: 'Non-electrical annotation.' },
  box: { displayName: 'Annotation box', category: 'Drawing', description: 'Non-electrical outline for grouping a section.' },
} satisfies Record<SupportedCircuitElementType, CircuitComponentLibraryMetadata>;

export type CircuitComponentLibraryEntry =
  CircuitComponentReferenceEntry &
    CircuitComponentLibraryMetadata &
    StudioLibraryResearchEntry;

export const CIRCUIT_COMPONENT_LIBRARY: CircuitComponentLibraryEntry[] = CIRCUIT_COMPONENT_REFERENCE
  .filter((entry) => entry.type !== 'kicad')
  .map((entry) => {
    const research =
      STUDIO_LIBRARY_RESEARCH[
        entry.type as keyof typeof STUDIO_LIBRARY_RESEARCH
      ];
    return {
      ...entry,
      ...COMPONENT_LIBRARY_METADATA[entry.type],
      ...research,
    };
  });

export function getCircuitComponentReference(
  type: unknown,
): (typeof CIRCUIT_COMPONENT_REFERENCE)[number] | undefined {
  if (typeof type !== 'string') return undefined;
  return CIRCUIT_COMPONENT_REFERENCE.find((entry) => entry.type === type);
}

export function getCircuitElementSchemaError(element: unknown): string | null {
  if (!element || typeof element !== 'object' || Array.isArray(element)) {
    return 'Circuit element must be an object.';
  }
  const record = element as Record<string, unknown>;
  const reference = getCircuitComponentReference(record.type);
  if (!reference) {
    return `Unsupported circuit element type: ${String(record.type)}`;
  }
  const missingProperties = reference.requiredProperties.filter(
    (property) => !Object.hasOwn(record, property),
  );
  if (missingProperties.length > 0) {
    return `${reference.type} element is missing required properties: ${missingProperties.join(', ')}.`;
  }
  if (record.type === 'ic' || record.type === 'connector') {
    if (!Array.isArray(record.pins) || record.pins.length < 2 || record.pins.length > 32) {
      return `${record.type} element needs between 2 and 32 named pins.`;
    }
    const names = new Set<string>();
    for (const pin of record.pins) {
      if (
        !pin ||
        typeof pin !== 'object' ||
        Array.isArray(pin) ||
        typeof (pin as { name?: unknown }).name !== 'string' ||
        !(pin as { name: string }).name.trim() ||
        !['left', 'right'].includes(String((pin as { side?: unknown }).side))
      ) {
        return `${record.type} pins need a non-empty name and a side of "left" or "right".`;
      }
      const name = (pin as { name: string }).name.trim();
      if (names.has(name)) return `${record.type} pin names must be unique.`;
      names.add(name);
    }
    if (!record.pins.some((pin) => (pin as { side: string }).side === 'left')) {
      return `${record.type} needs at least one left-side pin.`;
    }
    if (!record.pins.some((pin) => (pin as { side: string }).side === 'right')) {
      return `${record.type} needs at least one right-side pin.`;
    }
  }
  if (record.type === 'kicad') {
    if (
      typeof record.symbolId !== 'string' ||
      !/^[^:\s]+:[^:\s]+$/.test(record.symbolId) ||
      !isPoint(record.at)
    ) {
      return 'kicad elements need an exact Library:Symbol ID and a numeric at point.';
    }
    for (const property of ['unit', 'bodyStyle'] as const) {
      const value = record[property];
      if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1)) {
        return `kicad ${property} must be a positive integer.`;
      }
    }
    if (
      record.rotation !== undefined &&
      (typeof record.rotation !== 'number' ||
        !Number.isFinite(record.rotation))
    ) {
      return 'kicad rotation must be a finite angle in degrees.';
    }
    if (record.symbolData !== undefined) {
      const symbolData = record.symbolData as Partial<KicadSymbolData> | null;
      if (
        !symbolData ||
        typeof symbolData !== 'object' ||
        symbolData.id !== record.symbolId ||
        !Array.isArray(symbolData.units) ||
        symbolData.units.length < 1 ||
        symbolData.units.length > 256
      ) {
        return 'kicad symbolData must match the selected symbol ID and contain valid units.';
      }
      const unitNumber = Number.isInteger(record.unit) ? record.unit as number : 1;
      const bodyStyle = Number.isInteger(record.bodyStyle) ? record.bodyStyle as number : 1;
      const unitData = symbolData.units.find(
        (unit) => unit?.unit === unitNumber && unit?.bodyStyle === bodyStyle,
      );
      if (!unitData || !Array.isArray(unitData.pins) || !Array.isArray(unitData.graphics)) {
        return `kicad symbolData does not contain unit ${unitNumber}, body style ${bodyStyle}.`;
      }
      if (unitData.pins.length > 512 || unitData.graphics.length > 2048) {
        return 'kicad symbolData exceeds the supported drawing size.';
      }
      for (const pin of unitData.pins) {
        if (
          !pin ||
          typeof pin.number !== 'string' ||
          typeof pin.name !== 'string' ||
          typeof pin.shape !== 'string' ||
          !isPoint(pin.point) ||
          !isPoint(pin.bodyPoint)
        ) {
          return 'kicad symbolData contains an invalid pin definition.';
        }
      }
      for (const graphic of unitData.graphics) {
        if (
          !graphic ||
          !['polyline', 'rectangle', 'circle', 'arc', 'bezier', 'text'].includes(graphic.type) ||
          (graphic.points !== undefined &&
            (!Array.isArray(graphic.points) || graphic.points.some((point) => !isPoint(point)))) ||
          (graphic.radius !== undefined &&
            (typeof graphic.radius !== 'number' || !Number.isFinite(graphic.radius))) ||
          (graphic.text !== undefined && typeof graphic.text !== 'string') ||
          (graphic.strokeWidth !== undefined &&
            (typeof graphic.strokeWidth !== 'number' || !Number.isFinite(graphic.strokeWidth)))
        ) {
          return 'kicad symbolData contains an unsupported or invalid drawing primitive.';
        }
      }
    }
  }
  if (
    record.type === 'crossing' &&
    record.orientation !== undefined &&
    record.orientation !== 'horizontal' &&
    record.orientation !== 'vertical'
  ) {
    return 'crossing orientation must be "horizontal" or "vertical".';
  }
  return null;
}

export function isSupportedCircuitElementType(
  value: unknown,
): value is SupportedCircuitElementType {
  return typeof value === 'string' &&
    CIRCUIT_SUPPORTED_ELEMENT_TYPES.includes(value as SupportedCircuitElementType);
}

function isPoint(value: unknown): value is CircuitPoint {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]);
}

function copyPoint(point: CircuitPoint): CircuitPoint {
  return [point[0], point[1]];
}

/**
 * Applies the Circuit Studio KiCad transform in renderer order: horizontal
 * mirror, rotation, then translation. Kept unrounded so callers that render
 * vector artwork do not lose precision; pin anchors are rounded separately for
 * compatibility with the existing catalog contract.
 */
export function transformKicadPoint(
  point: CircuitPoint,
  origin: CircuitPoint,
  rotationDegrees = 0,
  flipX = false,
): CircuitPoint {
  const rotation = rotationDegrees * Math.PI / 180;
  const localX = point[0] * (flipX ? -1 : 1);
  const localY = point[1];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [
    origin[0] + localX * cos - localY * sin,
    origin[1] + localX * sin + localY * cos,
  ];
}

function coordinateOffset(value: number, axis: 'x' | 'y'): string {
  if (value === 0) return axis;
  return `${axis}${value > 0 ? '+' : '−'}${Math.abs(value)}`;
}

function formatOffset([x, y]: readonly [number, number]): string {
  return `(${coordinateOffset(x, 'x')}, ${coordinateOffset(y, 'y')})`;
}

export function getCircuitPins(element: CircuitElementGeometry): CircuitPin[] {
  const type = typeof element.type === 'string' ? element.type : '';
  const twoTerminalNames =
    TWO_TERMINAL_PIN_NAMES[type as keyof typeof TWO_TERMINAL_PIN_NAMES];

  if (twoTerminalNames && isPoint(element.from) && isPoint(element.to)) {
    return [
      { name: twoTerminalNames[0], point: copyPoint(element.from) },
      { name: twoTerminalNames[1], point: copyPoint(element.to) },
    ];
  }

  if ((type === 'npn' || type === 'pnp') && isPoint(element.at)) {
    const [x, y] = element.at;
    const mirrored = element.flip === true ? -1 : 1;
    return Object.entries(TRANSISTOR_PIN_OFFSETS[type]).map(([name, [dx, dy]]) => ({
      name,
      point: [x + dx * mirrored, y + dy],
    }));
  }

  if (
    Object.hasOwn(FIELD_EFFECT_PIN_OFFSETS, type) &&
    isPoint(element.at)
  ) {
    const [x, y] = element.at;
    const mirrored = element.flip === true ? -1 : 1;
    return Object.entries(FIELD_EFFECT_PIN_OFFSETS[type as keyof typeof FIELD_EFFECT_PIN_OFFSETS])
      .map(([name, [dx, dy]]) => ({
        name,
        point: [x + dx * mirrored, y + dy],
      }));
  }

  if ((type === 'opamp' || type === 'comparator') && isPoint(element.at)) {
    const [x, y] = element.at;
    const inputTop = element.swap === true ? 20 : -20;
    const inputBottom = -inputTop;
    return [
      { name: 'INV', point: [x - 40, y + inputTop] },
      { name: 'NONINV', point: [x - 40, y + inputBottom] },
      { name: 'OUT', point: [x + 40, y] },
    ];
  }

  if (type === 'potentiometer' && isPoint(element.at)) {
    const [x, y] = element.at;
    return [
      { name: 'A', point: [x - 44, y] },
      { name: 'W', point: [x, y - 52] },
      { name: 'B', point: [x + 44, y] },
    ];
  }

  if (type === 'regulator' && isPoint(element.at)) {
    const [x, y] = element.at;
    return [
      { name: 'IN', point: [x - 50, y] },
      { name: 'GND', point: [x, y + 50] },
      { name: 'OUT', point: [x + 50, y] },
    ];
  }

  if (type === 'transformer' && isPoint(element.at)) {
    const [x, y] = element.at;
    return [
      { name: 'P1', point: [x - 50, y - 30] },
      { name: 'P2', point: [x - 50, y + 30] },
      { name: 'S1', point: [x + 50, y - 30] },
      { name: 'S2', point: [x + 50, y + 30] },
    ];
  }

  if (type === 'relay' && isPoint(element.at)) {
    const [x, y] = element.at;
    return [
      { name: 'COIL1', point: [x - 55, y - 20] },
      { name: 'COIL2', point: [x - 55, y + 20] },
      { name: 'COM', point: [x + 55, y] },
      { name: 'NC', point: [x + 55, y - 30] },
      { name: 'NO', point: [x + 55, y + 30] },
    ];
  }

  if (type === 'bridge' && isPoint(element.at)) {
    const [x, y] = element.at;
    return [
      { name: 'AC1', point: [x - 50, y - 30] },
      { name: 'AC2', point: [x - 50, y + 30] },
      { name: 'POS', point: [x + 50, y - 30] },
      { name: 'NEG', point: [x + 50, y + 30] },
    ];
  }

  if (type === 'opto' && isPoint(element.at)) {
    const [x, y] = element.at;
    return [
      { name: 'IN+', point: [x - 50, y - 20] },
      { name: 'IN-', point: [x - 50, y + 20] },
      { name: 'OUT', point: [x + 50, y - 20] },
      { name: 'EMIT', point: [x + 50, y + 20] },
    ];
  }

  if ((type === 'ic' || type === 'connector') && isPoint(element.at) && Array.isArray((element as { pins?: unknown }).pins)) {
    const [x, y] = element.at;
    const pins = (element as { pins: Array<{ name: string; side: 'left' | 'right' }> }).pins;
    const sideCounts = {
      left: pins.filter((pin) => pin?.side === 'left').length,
      right: pins.filter((pin) => pin?.side === 'right').length,
    };
    const sideIndexes = { left: 0, right: 0 };
    return pins.flatMap((pin) => {
      if (!pin || (pin.side !== 'left' && pin.side !== 'right') || typeof pin.name !== 'string') return [];
      const index = sideIndexes[pin.side]++;
      const offsetY = (index - (sideCounts[pin.side] - 1) / 2) * 24;
      return [{
        name: pin.name,
        point: [x + (pin.side === 'left' ? -64 : 64), y + offsetY],
      }];
    });
  }

  if (type === 'kicad' && isPoint(element.at)) {
    const symbolData = element.symbolData as KicadSymbolData | undefined;
    const unitNumber = Number.isInteger(element.unit) ? element.unit as number : 1;
    const bodyStyle = Number.isInteger(element.bodyStyle) ? element.bodyStyle as number : 1;
    const unitData = symbolData?.units?.find(
      (unit) => unit.unit === unitNumber && unit.bodyStyle === bodyStyle,
    );
    if (!unitData) return [];
    const cleanCoordinate = (value: number) => Math.round(value * 100) / 100;
    return unitData.pins.flatMap((pin) => {
      if (!pin || !isPoint(pin.point)) return [];
      const point = transformKicadPoint(
        pin.point,
        element.at as CircuitPoint,
        typeof element.rotation === 'number' ? element.rotation : 0,
        element.flip === true,
      );
      return [{
        name: pin.number || pin.name || 'pin',
        point: [
          cleanCoordinate(point[0]),
          cleanCoordinate(point[1]),
        ],
      }];
    });
  }

  if (SINGLE_PIN_TYPES.has(type) && isPoint(element.at)) {
    return [{ name: 'at', point: copyPoint(element.at) }];
  }

  return [];
}

export function formatCircuitPinGuide(): string {
  const lines = [
    'Two-terminal pin locations:',
    ...Object.entries(TWO_TERMINAL_PIN_NAMES).map(
      ([type, [first, second]]) =>
        `${type}: ${first} is exactly at from; ${second} is exactly at to.`,
    ),
  ];

  for (const type of ['npn', 'pnp'] as const) {
    const offsets = TRANSISTOR_PIN_OFFSETS[type];
    const pins = Object.entries(offsets)
      .map(([name, offset]) => `${name}=${formatOffset(offset)}`)
      .join(', ');
    lines.push(
      `${type.toUpperCase()}: ${pins}; flip:true mirrors all x offsets.`,
    );
  }

  lines.push(
    `opamp: INV=${formatOffset([-40, -20])}, NONINV=${formatOffset([-40, 20])}, OUT=${formatOffset([40, 0])}; swap:true exchanges the two input y offsets.`,
    'ground, antenna, terminal: the pin is exactly at the element at coordinate.',
    'kicad: use the exact symbolId and per-unit pin offsets supplied in the selected KiCad library definitions; element.at is the symbol origin, rotation accepts any finite angle in degrees (including fractional and negative angles). Preserve the exact angle the user requests; otherwise, choose an angle that improves a clear layout. Rotate each pin offset around the origin using x′=x cos(θ)−y sin(θ), y′=x sin(θ)+y cos(θ), then add element.at. unit/bodyStyle default to 1.',
  );

  return lines.join('\n');
}

export {
  CIRCUIT_GEOMETRY_COMPATIBILITY_PROPERTY_KEYS,
  getCircuitPinIdentities,
  resolveCircuitComponentGeometry,
  type CircuitGeometryBounds,
  type CircuitGeometryPinIdentity,
  type CircuitGeometryResolution,
  type CircuitGeometryTextBound,
  type ResolvedCircuitPin,
} from './resolver.ts';

export function formatCircuitComponentGuide(): string {
  const componentLines = CIRCUIT_COMPONENT_LIBRARY.map((entry) => {
    const optional =
      entry.optionalProperties.length > 0
        ? entry.optionalProperties.join(', ')
        : 'none';
    const pinCount =
      entry.pinCount === null ? 'n/a' : String(entry.pinCount);
    const minimumDistance =
      'minimumTerminalDistance' in entry
        ? ` Minimum endpoint distance: ${entry.minimumTerminalDistance} px.`
        : '';
    return `- ${entry.type} (${entry.displayName}; ${entry.category}): ${entry.description} Required ${entry.requiredProperties.join(', ')}; optional ${optional}; pin count ${pinCount}; pins ${entry.pinNames}; positions ${entry.pinPositions} Connection rule: ${entry.connectionRules} ${entry.validation} Auto-fix: ${entry.autoFix}${minimumDistance}`;
  });

  return [
    'Use only these exact CircuitDraw element type identifiers and schemas:',
    ...componentLines,
    '- kicad (imported KiCad symbol): required symbolId, at; optional id, label, value, unit, bodyStyle, rotation, flip. Use only exact IDs and unit pin offsets provided in the selected library definitions. The server attaches the trusted source geometry.',
    'General pin offsets:',
    formatCircuitPinGuide(),
  ].join('\n');
}

export function formatRelevantCircuitComponentResearchContext(
  queryTexts: string[],
  requestedLimit = 8,
): string {
  const stopWords = new Set([
    'add', 'all', 'and', 'are', 'can', 'circuit', 'component', 'components',
    'create', 'for', 'from', 'have', 'help', 'how', 'into', 'make', 'need',
    'please', 'show', 'symbol', 'symbols', 'that', 'the', 'this', 'use',
    'using', 'what', 'with',
  ]);
  const queryTokens = new Set(
    queryTexts
      .join(' ')
      .toLocaleLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length > 1 && !stopWords.has(token)) ?? [],
  );
  if (!queryTokens.size) return '';

  const ranked = CIRCUIT_COMPONENT_LIBRARY.map((entry) => {
    const identity = `${entry.type} ${entry.displayName}`.toLocaleLowerCase();
    const keywords = entry.keywords.join(' ').toLocaleLowerCase();
    const short = entry.shortDescription.toLocaleLowerCase();
    const long = entry.longDescription.toLocaleLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (identity.includes(token)) score += 5;
      else if (keywords.includes(token)) score += 4;
      else if (short.includes(token)) score += 2;
      else if (long.includes(token)) score += 1;
    }
    return { entry, score };
  })
    .filter((item) => item.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.entry.type.localeCompare(right.entry.type),
    )
    .slice(0, Math.max(1, Math.min(12, Math.floor(requestedLimit) || 8)));

  if (!ranked.length) return '';
  return [
    'Relevant built-in Circuit Studio component references. These descriptions explain symbol purpose; they do not verify electrical behavior, ratings, or safety.',
    ...ranked.map(({ entry }) =>
      `- ${entry.type} (${entry.displayName}): ${entry.shortDescription} Detailed reference: ${entry.longDescription} Search terms: ${entry.keywords.join(', ')}`,
    ),
  ].join('\n');
}
