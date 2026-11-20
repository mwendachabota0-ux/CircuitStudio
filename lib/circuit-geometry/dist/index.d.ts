export type CircuitPoint = [number, number];
export type CircuitPin = {
    name: string;
    point: CircuitPoint;
};
export type CircuitElementGeometry = {
    type?: unknown;
    from?: unknown;
    to?: unknown;
    at?: unknown;
    flip?: unknown;
    swap?: unknown;
};
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
/**
 * The compatibility contract shared by CircuitDraw, AI prompts, and server
 * input validation. Keep this list aligned with the renderer's actual symbols.
 */
export declare const CIRCUIT_COMPONENT_REFERENCE: readonly [{
    readonly type: "resistor";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor", "style"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 50;
}, {
    readonly type: "capacitor";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated; electrical behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 12;
}, {
    readonly type: "electrolytic";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "+, -";
    readonly pinPositions: "+ is exactly at from; - is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity follows endpoint order.";
    readonly validation: "Rendered and structurally validated; electrical behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 12;
}, {
    readonly type: "inductor";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated; electrical behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 64;
}, {
    readonly type: "diode";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "A, K";
    readonly pinPositions: "A (anode) is exactly at from; K (cathode) is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity follows endpoint order.";
    readonly validation: "Rendered and structurally validated; electrical behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 20;
}, {
    readonly type: "zener";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "A, K";
    readonly pinPositions: "A (anode) is exactly at from; K (cathode) is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity follows endpoint order.";
    readonly validation: "Rendered and structurally validated; electrical behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 20;
}, {
    readonly type: "led";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "A, K";
    readonly pinPositions: "A (anode) is exactly at from; K (cathode) is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity follows endpoint order.";
    readonly validation: "Rendered and structurally validated; electrical behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 20;
}, {
    readonly type: "battery";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "+, -";
    readonly pinPositions: "+ is exactly at from; - is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity follows endpoint order.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 10;
}, {
    readonly type: "switch";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor", "closed"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; closed controls the drawn blade only.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 36;
}, {
    readonly type: "mic";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 36;
}, {
    readonly type: "speaker";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 24;
}, {
    readonly type: "lamp";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 28;
}, {
    readonly type: "acsource";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 32;
}, {
    readonly type: "crystal";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
    readonly minimumTerminalDistance: 18;
}, {
    readonly type: "npn";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "flip", "circle", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "B, C, E";
    readonly pinPositions: "B=(x-25,y), C=(x+25,y-44), E=(x+25,y+44); flip:true mirrors x offsets.";
    readonly connectionRules: "Wire endpoints must land on the calculated pin coordinates.";
    readonly validation: "Rendered and structurally validated; no general transistor electrical simulation.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
}, {
    readonly type: "pnp";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "flip", "circle", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "B, E, C";
    readonly pinPositions: "B=(x-25,y), E=(x+25,y-44), C=(x+25,y+44); flip:true mirrors x offsets.";
    readonly connectionRules: "Wire endpoints must land on the calculated pin coordinates.";
    readonly validation: "Rendered and structurally validated; no general transistor electrical simulation.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
}, {
    readonly type: "opamp";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "swap", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "INV, NONINV, OUT";
    readonly pinPositions: "INV=(x-40,y-20), NONINV=(x-40,y+20), OUT=(x+40,y); swap:true exchanges input y offsets.";
    readonly connectionRules: "Generic three-pin symbol only; no IC supply pins are modeled.";
    readonly validation: "Rendered and structurally validated; no amplifier electrical simulation.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
}, {
    readonly type: "ground";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 1;
    readonly pinNames: "at";
    readonly pinPositions: "The only pin is exactly at at.";
    readonly connectionRules: "Connect a wire endpoint or a wire segment to at.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
}, {
    readonly type: "antenna";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "height", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 1;
    readonly pinNames: "at";
    readonly pinPositions: "The only pin is exactly at at; height changes the drawn mast, not the pin.";
    readonly connectionRules: "Connect a wire endpoint or a wire segment to at.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
}, {
    readonly type: "terminal";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 1;
    readonly pinNames: "at";
    readonly pinPositions: "The only pin is exactly at at.";
    readonly connectionRules: "Connect a wire endpoint or a wire segment to at.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.";
}, {
    readonly type: "wire";
    readonly requiredProperties: readonly ["points"];
    readonly optionalProperties: readonly ["id", "label", "open"];
    readonly pinCount: null;
    readonly pinNames: "Not a component; endpoints are points[0] and points[last].";
    readonly pinPositions: "Every points entry is a route coordinate.";
    readonly connectionRules: "Use two or more points; route orthogonally; endpoints connect exactly. Crossings alone do not connect; use a junction for an explicit crossing connection. Set open:true only for an intentionally open wire.";
    readonly validation: "Rendered and structurally validated; disconnected endpoints and component overlaps are blocking errors.";
    readonly autoFix: "Only unique endpoint snaps within 8 px and limited eligible rail-tail trimming.";
}, {
    readonly type: "junction";
    readonly requiredProperties: readonly ["x", "y"];
    readonly optionalProperties: readonly ["id", "label"];
    readonly pinCount: 1;
    readonly pinNames: "junction";
    readonly pinPositions: "The junction is at (x,y).";
    readonly connectionRules: "Place exactly on the wire intersection or wire endpoint that should connect.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "No junction relocation or topology repair.";
}, {
    readonly type: "label";
    readonly requiredProperties: readonly ["at", "text"];
    readonly optionalProperties: readonly ["id", "anchor", "size", "bold", "muted"];
    readonly pinCount: 0;
    readonly pinNames: "None.";
    readonly pinPositions: "Not an electrical connection.";
    readonly connectionRules: "Text annotation only; it does not connect nets.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "No label repair.";
}, {
    readonly type: "box";
    readonly requiredProperties: readonly ["x", "y", "w", "h"];
    readonly optionalProperties: readonly ["id", "label", "value"];
    readonly pinCount: 0;
    readonly pinNames: "None.";
    readonly pinPositions: "Not an electrical connection.";
    readonly connectionRules: "Drawing annotation only; it does not connect nets.";
    readonly validation: "Rendered and structurally validated.";
    readonly autoFix: "No box repair.";
}];
export type SupportedCircuitElementType = (typeof CIRCUIT_COMPONENT_REFERENCE)[number]['type'];
export declare const CIRCUIT_SUPPORTED_ELEMENT_TYPES: SupportedCircuitElementType[];
export declare function getCircuitComponentReference(type: unknown): (typeof CIRCUIT_COMPONENT_REFERENCE)[number] | undefined;
export declare function getCircuitElementSchemaError(element: unknown): string | null;
export declare function isSupportedCircuitElementType(value: unknown): value is SupportedCircuitElementType;
export declare function getCircuitPins(element: CircuitElementGeometry): CircuitPin[];
export declare function formatCircuitPinGuide(): string;
export declare function formatCircuitComponentGuide(): string;
//# sourceMappingURL=index.d.ts.map