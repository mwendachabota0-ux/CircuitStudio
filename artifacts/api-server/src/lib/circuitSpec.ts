import { GenerateCircuitResponse } from "@workspace/api-zod";
import { getCircuitElementSchemaError } from "@workspace/circuit-geometry";
import { getKicadSymbolData } from "./kicadSymbols";

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

export async function hydrateKicadSymbols<T extends { elements: Array<Record<string, unknown>> }>(
  circuit: T,
): Promise<T> {
  const elements = await Promise.all(circuit.elements.map(async (element) => {
    if (element.type !== "kicad") return element;
    const symbolId = typeof element.symbolId === "string" ? element.symbolId : "";
    const symbolData = await getKicadSymbolData(symbolId);
    const requestedUnit = typeof element.unit === "number" &&
      Number.isInteger(element.unit)
      ? element.unit
      : undefined;
    const requestedBodyStyle = typeof element.bodyStyle === "number" &&
      Number.isInteger(element.bodyStyle)
      ? element.bodyStyle
      : undefined;
    const unitData = symbolData.units.find((unit) =>
      (requestedUnit === undefined || unit.unit === requestedUnit) &&
      (requestedBodyStyle === undefined || unit.bodyStyle === requestedBodyStyle)
    ) ?? symbolData.units.find((unit) =>
      requestedUnit === undefined || unit.unit === requestedUnit
    ) ?? symbolData.units[0];

    if (!unitData) {
      throw new CircuitSpecCompatibilityError(
        `KiCad symbol ${symbolId} does not have a usable drawing unit.`,
      );
    }

    return {
      ...element,
      unit: unitData.unit,
      bodyStyle: unitData.bodyStyle,
      symbolData,
    };
  }));

  return { ...circuit, elements } as T;
}
