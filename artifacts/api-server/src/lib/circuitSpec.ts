import { GenerateCircuitResponse } from "@workspace/api-zod";
import { getCircuitElementSchemaError } from "@workspace/circuit-geometry";

export class CircuitSpecCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitSpecCompatibilityError";
  }
}

export function parseUsableCircuit(value: unknown) {
  const circuit = GenerateCircuitResponse.parse(value);
  if (circuit.elements.length === 0 || circuit.elements.length > 300) {
    throw new Error("Circuit must contain between 1 and 300 elements.");
  }
  for (const element of circuit.elements) {
    const schemaError = getCircuitElementSchemaError(element);
    if (schemaError) throw new CircuitSpecCompatibilityError(schemaError);
  }
  return circuit;
}
