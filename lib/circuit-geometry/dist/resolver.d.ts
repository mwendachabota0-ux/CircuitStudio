import { type CircuitElementGeometry, type CircuitPoint } from './index.ts';
export type CircuitGeometryBounds = {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
};
export type CircuitGeometryPinIdentity = {
    id: string;
    name: string;
    number?: string;
    unit?: number;
    bodyStyle?: number;
    occurrence?: number;
    electricalType?: string;
};
export type ResolvedCircuitPin = CircuitGeometryPinIdentity & {
    point: CircuitPoint;
    bodyPoint?: CircuitPoint;
};
export type CircuitGeometryTextBound = {
    role: 'reference' | 'value' | 'pin-name' | 'pin-number' | 'symbol-text';
    text: string;
    bounds: CircuitGeometryBounds;
    confidence: 'render-aligned' | 'conservative-estimate';
};
/**
 * Keys that must not be independently overridden from placement.properties.
 * Their authority is either the component's catalog/source data or the
 * placement's explicit transform/legacyGeometry fields.
 */
export declare const CIRCUIT_GEOMETRY_COMPATIBILITY_PROPERTY_KEYS: readonly ["from", "to", "at", "rotation", "flip", "symbolId", "symbolData", "unit", "bodyStyle", "pins", "swap", "height", "circle"];
export type CircuitGeometryResolution = {
    status: 'resolved';
    source: 'catalog' | 'kicad-source';
    pins: ResolvedCircuitPin[];
    bodyBounds: CircuitGeometryBounds;
    textBounds: CircuitGeometryTextBound[];
    transform: {
        origin?: CircuitPoint;
        rotation: number;
        flipX: boolean;
        unit?: number;
        bodyStyle?: number;
    };
} | {
    status: 'unsupported';
    code: 'component-type-unsupported' | 'pin-geometry-unavailable' | 'body-geometry-unavailable' | 'text-geometry-unavailable';
    message: string;
};
export declare function getCircuitPinIdentities(input: CircuitElementGeometry): CircuitGeometryPinIdentity[] | null;
/**
 * Resolves stable pin identities/anchors plus conservative body and text
 * extents without mutating the supplied drawing element.
 */
export declare function resolveCircuitComponentGeometry(input: CircuitElementGeometry): CircuitGeometryResolution;
//# sourceMappingURL=resolver.d.ts.map