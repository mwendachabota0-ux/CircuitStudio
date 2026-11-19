import { GenerateCircuitResponse } from "@workspace/api-zod";

const supportedElementTypes = new Set([
  "resistor",
  "capacitor",
  "electrolytic",
  "inductor",
  "diode",
  "zener",
  "led",
  "battery",
  "switch",
  "mic",
  "speaker",
  "lamp",
  "acsource",
  "crystal",
  "npn",
  "pnp",
  "opamp",
  "ground",
  "antenna",
  "terminal",
  "wire",
  "junction",
  "label",
  "box",
]);

export function parseUsableCircuit(value: unknown) {
  const circuit = GenerateCircuitResponse.parse(value);
  if (circuit.elements.length === 0 || circuit.elements.length > 300) {
    throw new Error("Circuit must contain between 1 and 300 elements.");
  }
  const unsupported = circuit.elements.find(
    (element) => !supportedElementTypes.has(element.type),
  );
  if (unsupported) {
    throw new Error(`Unsupported circuit element type: ${unsupported.type}`);
  }
  return circuit;
}
