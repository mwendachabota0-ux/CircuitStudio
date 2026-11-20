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
export declare function getCircuitPins(element: CircuitElementGeometry): CircuitPin[];
export declare function formatCircuitPinGuide(): string;
//# sourceMappingURL=index.d.ts.map