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
    readonly type: "fuse";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; a symbol is not a current rating.";
    readonly validation: "Rendered and structurally validated; fuse sizing is not checked.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 46;
}, {
    readonly type: "thermistor";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated; temperature response is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 50;
}, {
    readonly type: "photoresistor";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated; light response is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 50;
}, {
    readonly type: "varistor";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated; surge protection ratings are not checked.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 50;
}, {
    readonly type: "photodiode";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "A, K";
    readonly pinPositions: "A (anode) is exactly at from; K (cathode) is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity follows endpoint order.";
    readonly validation: "Rendered and structurally validated; optical behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 20;
}, {
    readonly type: "schottky";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "A, K";
    readonly pinPositions: "A (anode) is exactly at from; K (cathode) is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity follows endpoint order.";
    readonly validation: "Rendered and structurally validated; forward drop and current ratings are not checked.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 24;
}, {
    readonly type: "dcsource";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "+, -";
    readonly pinPositions: "+ is exactly at from; - is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity follows endpoint order.";
    readonly validation: "Rendered and structurally validated; source limits are not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 42;
}, {
    readonly type: "currentsource";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "+, -";
    readonly pinPositions: "+ is exactly at from; - is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity follows endpoint order.";
    readonly validation: "Rendered and structurally validated; source limits are not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 42;
}, {
    readonly type: "motor";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity and load are not inferred.";
    readonly validation: "Rendered and structurally validated; motor behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 44;
}, {
    readonly type: "buzzer";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "1, 2";
    readonly pinPositions: "Pin 1 is exactly at from; pin 2 is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to.";
    readonly validation: "Rendered and structurally validated; drive requirements are not checked.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 44;
}, {
    readonly type: "solarcell";
    readonly requiredProperties: readonly ["from", "to"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 2;
    readonly pinNames: "+, -";
    readonly pinPositions: "+ is exactly at from; - is exactly at to.";
    readonly connectionRules: "Connect wire endpoints exactly to from/to; polarity follows endpoint order.";
    readonly validation: "Rendered and structurally validated; light response is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
    readonly minimumTerminalDistance: 44;
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
    readonly type: "potentiometer";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "A, W, B";
    readonly pinPositions: "A=(x-44,y), W=(x,y-52), B=(x+44,y).";
    readonly connectionRules: "The wiper is W; do not treat the symbol as a two-terminal resistor.";
    readonly validation: "Rendered and structurally validated; resistance and wiper position are not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "nmos";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "flip", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "G, D, S";
    readonly pinPositions: "G=(x-40,y), D=(x+20,y-40), S=(x+20,y+40); flip:true mirrors x offsets.";
    readonly connectionRules: "Wire endpoints must land on the calculated gate, drain, or source coordinate.";
    readonly validation: "Rendered and structurally validated; MOSFET behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "pmos";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "flip", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "G, D, S";
    readonly pinPositions: "G=(x-40,y), D=(x+20,y-40), S=(x+20,y+40); flip:true mirrors x offsets.";
    readonly connectionRules: "Wire endpoints must land on the calculated gate, drain, or source coordinate.";
    readonly validation: "Rendered and structurally validated; MOSFET behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "mosfet";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "channel", "flip", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "G, D, S";
    readonly pinPositions: "G=(x-40,y), D=(x+20,y-40), S=(x+20,y+40); flip:true mirrors x offsets.";
    readonly connectionRules: "Wire endpoints must land on the calculated gate, drain, or source coordinate. Set channel to \"n\" or \"p\" when known.";
    readonly validation: "Rendered and structurally validated; MOSFET behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "njfet";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "flip", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "G, D, S";
    readonly pinPositions: "G=(x-40,y), D=(x+20,y-40), S=(x+20,y+40); flip:true mirrors x offsets.";
    readonly connectionRules: "Wire endpoints must land on the calculated gate, drain, or source coordinate.";
    readonly validation: "Rendered and structurally validated; JFET behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "pjfet";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "flip", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "G, D, S";
    readonly pinPositions: "G=(x-40,y), D=(x+20,y-40), S=(x+20,y+40); flip:true mirrors x offsets.";
    readonly connectionRules: "Wire endpoints must land on the calculated gate, drain, or source coordinate.";
    readonly validation: "Rendered and structurally validated; JFET behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "regulator";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "IN, GND, OUT";
    readonly pinPositions: "IN=(x-50,y), GND=(x,y+50), OUT=(x+50,y).";
    readonly connectionRules: "Connect only to the pin names shown; electrical ratings are not inferred.";
    readonly validation: "Rendered and structurally validated; regulation and thermal behavior are not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "comparator";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "swap", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 3;
    readonly pinNames: "INV, NONINV, OUT";
    readonly pinPositions: "INV=(x-40,y-20), NONINV=(x-40,y+20), OUT=(x+40,y); swap:true exchanges input y offsets.";
    readonly connectionRules: "Generic three-pin symbol only; supply pins are not modeled.";
    readonly validation: "Rendered and structurally validated; comparator behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "transformer";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 4;
    readonly pinNames: "P1, P2, S1, S2";
    readonly pinPositions: "P1=(x-50,y-30), P2=(x-50,y+30), S1=(x+50,y-30), S2=(x+50,y+30).";
    readonly connectionRules: "Primary and secondary are isolated symbol sides; the drawing does not specify ratings or certify isolation.";
    readonly validation: "Rendered and structurally validated; voltage ratio and insulation are not simulated or verified.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "relay";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 5;
    readonly pinNames: "COIL1, COIL2, COM, NC, NO";
    readonly pinPositions: "COIL1=(x-55,y-20), COIL2=(x-55,y+20), COM=(x+55,y), NC=(x+55,y-30), NO=(x+55,y+30).";
    readonly connectionRules: "Coil and contact pins are distinct; the default contact sketch is normally open.";
    readonly validation: "Rendered and structurally validated; coil ratings and switching behavior are not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "bridge";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 4;
    readonly pinNames: "AC1, AC2, POS, NEG";
    readonly pinPositions: "AC1=(x-50,y-30), AC2=(x-50,y+30), POS=(x+50,y-30), NEG=(x+50,y+30).";
    readonly connectionRules: "Use AC1/AC2 for the input pair and POS/NEG for the DC pair.";
    readonly validation: "Rendered and structurally validated; voltage and current ratings are not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "opto";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: 4;
    readonly pinNames: "IN+, IN-, OUT, EMIT";
    readonly pinPositions: "IN+=(x-50,y-20), IN-=(x-50,y+20), OUT=(x+50,y-20), EMIT=(x+50,y+20).";
    readonly connectionRules: "Input and output pins are shown on separate sides; the symbol is not a safety or isolation certification.";
    readonly validation: "Rendered and structurally validated; transfer behavior is not simulated.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "ic";
    readonly requiredProperties: readonly ["at", "pins"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: null;
    readonly pinNames: "Named pins with an explicit side (\"left\" or \"right\").";
    readonly pinPositions: "Each side is spaced vertically at 24 px around at; left pins are at x-64 and right pins at x+64.";
    readonly connectionRules: "Provide real pin names and sides from a datasheet or a known pinout; never guess a part-specific pinout.";
    readonly validation: "Rendered and structurally validated; internal IC behavior and pinout correctness are not checked.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
}, {
    readonly type: "connector";
    readonly requiredProperties: readonly ["at", "pins"];
    readonly optionalProperties: readonly ["id", "label", "value", "labelPos", "labelNudge", "labelAt", "labelAnchor"];
    readonly pinCount: null;
    readonly pinNames: "Named pins with an explicit side (\"left\" or \"right\").";
    readonly pinPositions: "Each side is spaced vertically at 24 px around at; left pins are at x-64 and right pins at x+64.";
    readonly connectionRules: "Use a unique pin name for each connector contact.";
    readonly validation: "Rendered and structurally validated; connector mechanical details are not modeled.";
    readonly autoFix: "May snap a unique wire endpoint within 8 px.";
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
    readonly type: "crossing";
    readonly requiredProperties: readonly ["at"];
    readonly optionalProperties: readonly ["id", "orientation"];
    readonly pinCount: 0;
    readonly pinNames: "None; drawing annotation only.";
    readonly pinPositions: "Place at the exact interior intersection of one horizontal and one vertical wire segment. orientation selects which wire is drawn as the bridge; defaults to horizontal.";
    readonly connectionRules: "This bridge marker keeps the two crossing wires electrically separate. Use a junction instead when they should connect.";
    readonly validation: "Rendered and structurally validated; crossing geometry is checked.";
    readonly autoFix: "No crossing relocation or topology repair.";
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
export type CircuitComponentCategory = 'Passives' | 'Semiconductors' | 'Power' | 'Protection' | 'Control' | 'Input / output' | 'Connectors' | 'Drawing';
type CircuitComponentLibraryMetadata = {
    displayName: string;
    category: CircuitComponentCategory;
    description: string;
};
export type CircuitComponentLibraryEntry = CircuitComponentReferenceEntry & CircuitComponentLibraryMetadata;
export declare const CIRCUIT_COMPONENT_LIBRARY: CircuitComponentLibraryEntry[];
export declare function getCircuitComponentReference(type: unknown): (typeof CIRCUIT_COMPONENT_REFERENCE)[number] | undefined;
export declare function getCircuitElementSchemaError(element: unknown): string | null;
export declare function isSupportedCircuitElementType(value: unknown): value is SupportedCircuitElementType;
export declare function getCircuitPins(element: CircuitElementGeometry): CircuitPin[];
export declare function formatCircuitPinGuide(): string;
export declare function formatCircuitComponentGuide(): string;
export {};
//# sourceMappingURL=index.d.ts.map