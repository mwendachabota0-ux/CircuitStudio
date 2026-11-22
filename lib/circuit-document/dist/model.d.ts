import { CIRCUIT_SUPPORTED_ELEMENT_TYPES } from "@workspace/circuit-geometry";
import { z } from "zod";
export declare const CIRCUIT_DOCUMENT_SCHEMA_VERSION: 2;
export declare const CIRCUIT_DOCUMENT_DRAWING_TYPES: readonly ["wire", "junction", "crossing", "label", "box"];
export type CircuitDocumentDrawingType = (typeof CIRCUIT_DOCUMENT_DRAWING_TYPES)[number];
export type CircuitDocumentComponentType = Exclude<(typeof CIRCUIT_SUPPORTED_ELEMENT_TYPES)[number], CircuitDocumentDrawingType>;
export type CircuitPoint = [number, number];
export type CircuitPinDefinition = {
    id: string;
    name: string;
    number?: string;
    unit?: number;
    bodyStyle?: number;
    occurrence?: number;
    electricalType?: string;
};
export type CircuitPinReference = {
    componentId: string;
    pinId: string;
};
export type CircuitDocumentDiagnostic = {
    code: string;
    severity: "error" | "warning";
    path: string;
    message: string;
};
export declare const CircuitDocumentV2Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<2>;
    id: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    electrical: z.ZodObject<{
        components: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            type: z.ZodType<CircuitDocumentComponentType, z.ZodTypeDef, CircuitDocumentComponentType>;
            reference: z.ZodOptional<z.ZodString>;
            value: z.ZodOptional<z.ZodString>;
            properties: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            pins: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                number: z.ZodOptional<z.ZodString>;
                unit: z.ZodOptional<z.ZodNumber>;
                bodyStyle: z.ZodOptional<z.ZodNumber>;
                occurrence: z.ZodOptional<z.ZodNumber>;
                electricalType: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                name: string;
                number?: string | undefined;
                unit?: number | undefined;
                bodyStyle?: number | undefined;
                occurrence?: number | undefined;
                electricalType?: string | undefined;
            }, {
                id: string;
                name: string;
                number?: string | undefined;
                unit?: number | undefined;
                bodyStyle?: number | undefined;
                occurrence?: number | undefined;
                electricalType?: string | undefined;
            }>, "many">;
        }, "strict", z.ZodTypeAny, {
            type: CircuitDocumentComponentType;
            id: string;
            properties: Record<string, unknown>;
            pins: {
                id: string;
                name: string;
                number?: string | undefined;
                unit?: number | undefined;
                bodyStyle?: number | undefined;
                occurrence?: number | undefined;
                electricalType?: string | undefined;
            }[];
            value?: string | undefined;
            reference?: string | undefined;
        }, {
            type: CircuitDocumentComponentType;
            id: string;
            properties: Record<string, unknown>;
            pins: {
                id: string;
                name: string;
                number?: string | undefined;
                unit?: number | undefined;
                bodyStyle?: number | undefined;
                occurrence?: number | undefined;
                electricalType?: string | undefined;
            }[];
            value?: string | undefined;
            reference?: string | undefined;
        }>, "many">;
        nets: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            members: z.ZodArray<z.ZodObject<{
                componentId: z.ZodString;
                pinId: z.ZodString;
            }, "strict", z.ZodTypeAny, {
                componentId: string;
                pinId: string;
            }, {
                componentId: string;
                pinId: string;
            }>, "many">;
        }, "strict", z.ZodTypeAny, {
            id: string;
            members: {
                componentId: string;
                pinId: string;
            }[];
            name?: string | undefined;
            attributes?: Record<string, unknown> | undefined;
        }, {
            id: string;
            members: {
                componentId: string;
                pinId: string;
            }[];
            name?: string | undefined;
            attributes?: Record<string, unknown> | undefined;
        }>, "many">;
        noConnects: z.ZodArray<z.ZodObject<{
            componentId: z.ZodString;
            pinId: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            componentId: string;
            pinId: string;
        }, {
            componentId: string;
            pinId: string;
        }>, "many">;
        unassignedPins: z.ZodArray<z.ZodObject<{
            componentId: z.ZodString;
            pinId: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            componentId: string;
            pinId: string;
        }, {
            componentId: string;
            pinId: string;
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        components: {
            type: CircuitDocumentComponentType;
            id: string;
            properties: Record<string, unknown>;
            pins: {
                id: string;
                name: string;
                number?: string | undefined;
                unit?: number | undefined;
                bodyStyle?: number | undefined;
                occurrence?: number | undefined;
                electricalType?: string | undefined;
            }[];
            value?: string | undefined;
            reference?: string | undefined;
        }[];
        nets: {
            id: string;
            members: {
                componentId: string;
                pinId: string;
            }[];
            name?: string | undefined;
            attributes?: Record<string, unknown> | undefined;
        }[];
        noConnects: {
            componentId: string;
            pinId: string;
        }[];
        unassignedPins: {
            componentId: string;
            pinId: string;
        }[];
    }, {
        components: {
            type: CircuitDocumentComponentType;
            id: string;
            properties: Record<string, unknown>;
            pins: {
                id: string;
                name: string;
                number?: string | undefined;
                unit?: number | undefined;
                bodyStyle?: number | undefined;
                occurrence?: number | undefined;
                electricalType?: string | undefined;
            }[];
            value?: string | undefined;
            reference?: string | undefined;
        }[];
        nets: {
            id: string;
            members: {
                componentId: string;
                pinId: string;
            }[];
            name?: string | undefined;
            attributes?: Record<string, unknown> | undefined;
        }[];
        noConnects: {
            componentId: string;
            pinId: string;
        }[];
        unassignedPins: {
            componentId: string;
            pinId: string;
        }[];
    }>;
    drawing: z.ZodObject<{
        units: z.ZodLiteral<"px">;
        canvas: z.ZodObject<{
            width: z.ZodOptional<z.ZodNumber>;
            height: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            width?: number | undefined;
            height?: number | undefined;
        }, {
            width?: number | undefined;
            height?: number | undefined;
        }>;
        placements: z.ZodArray<z.ZodObject<{
            componentId: z.ZodString;
            position: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
            rotation: z.ZodNumber;
            flip: z.ZodBoolean;
            legacyGeometry: z.ZodOptional<z.ZodObject<{
                from: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
                to: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
                at: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
            }, "strict", z.ZodTypeAny, {
                at?: [number, number] | undefined;
                from?: [number, number] | undefined;
                to?: [number, number] | undefined;
            }, {
                at?: [number, number] | undefined;
                from?: [number, number] | undefined;
                to?: [number, number] | undefined;
            }>>;
            properties: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strict", z.ZodTypeAny, {
            properties: Record<string, unknown>;
            componentId: string;
            position: [number, number];
            rotation: number;
            flip: boolean;
            legacyGeometry?: {
                at?: [number, number] | undefined;
                from?: [number, number] | undefined;
                to?: [number, number] | undefined;
            } | undefined;
        }, {
            properties: Record<string, unknown>;
            componentId: string;
            position: [number, number];
            rotation: number;
            flip: boolean;
            legacyGeometry?: {
                at?: [number, number] | undefined;
                from?: [number, number] | undefined;
                to?: [number, number] | undefined;
            } | undefined;
        }>, "many">;
        routes: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            netId: z.ZodString;
            points: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>, "many">;
            open: z.ZodOptional<z.ZodBoolean>;
            properties: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            properties: Record<string, unknown>;
            netId: string;
            points: [number, number][];
            open?: boolean | undefined;
        }, {
            id: string;
            properties: Record<string, unknown>;
            netId: string;
            points: [number, number][];
            open?: boolean | undefined;
        }>, "many">;
        junctions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            at: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
            routeIds: z.ZodArray<z.ZodString, "many">;
            properties: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strict", z.ZodTypeAny, {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
        }, {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
        }>, "many">;
        crossings: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            at: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
            orientation: z.ZodOptional<z.ZodEnum<["horizontal", "vertical"]>>;
            routeIds: z.ZodArray<z.ZodString, "many">;
            properties: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strict", z.ZodTypeAny, {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
            orientation?: "horizontal" | "vertical" | undefined;
        }, {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
            orientation?: "horizontal" | "vertical" | undefined;
        }>, "many">;
        annotations: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"label">;
            at: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
            text: z.ZodString;
            properties: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strict", z.ZodTypeAny, {
            at: [number, number];
            type: "label";
            id: string;
            properties: Record<string, unknown>;
            text: string;
        }, {
            at: [number, number];
            type: "label";
            id: string;
            properties: Record<string, unknown>;
            text: string;
        }>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"box">;
            x: z.ZodNumber;
            y: z.ZodNumber;
            w: z.ZodNumber;
            h: z.ZodNumber;
            properties: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strict", z.ZodTypeAny, {
            type: "box";
            id: string;
            properties: Record<string, unknown>;
            x: number;
            y: number;
            w: number;
            h: number;
        }, {
            type: "box";
            id: string;
            properties: Record<string, unknown>;
            x: number;
            y: number;
            w: number;
            h: number;
        }>]>, "many">;
    }, "strict", z.ZodTypeAny, {
        units: "px";
        canvas: {
            width?: number | undefined;
            height?: number | undefined;
        };
        placements: {
            properties: Record<string, unknown>;
            componentId: string;
            position: [number, number];
            rotation: number;
            flip: boolean;
            legacyGeometry?: {
                at?: [number, number] | undefined;
                from?: [number, number] | undefined;
                to?: [number, number] | undefined;
            } | undefined;
        }[];
        routes: {
            id: string;
            properties: Record<string, unknown>;
            netId: string;
            points: [number, number][];
            open?: boolean | undefined;
        }[];
        junctions: {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
        }[];
        crossings: {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
            orientation?: "horizontal" | "vertical" | undefined;
        }[];
        annotations: ({
            at: [number, number];
            type: "label";
            id: string;
            properties: Record<string, unknown>;
            text: string;
        } | {
            type: "box";
            id: string;
            properties: Record<string, unknown>;
            x: number;
            y: number;
            w: number;
            h: number;
        })[];
    }, {
        units: "px";
        canvas: {
            width?: number | undefined;
            height?: number | undefined;
        };
        placements: {
            properties: Record<string, unknown>;
            componentId: string;
            position: [number, number];
            rotation: number;
            flip: boolean;
            legacyGeometry?: {
                at?: [number, number] | undefined;
                from?: [number, number] | undefined;
                to?: [number, number] | undefined;
            } | undefined;
        }[];
        routes: {
            id: string;
            properties: Record<string, unknown>;
            netId: string;
            points: [number, number][];
            open?: boolean | undefined;
        }[];
        junctions: {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
        }[];
        crossings: {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
            orientation?: "horizontal" | "vertical" | undefined;
        }[];
        annotations: ({
            at: [number, number];
            type: "label";
            id: string;
            properties: Record<string, unknown>;
            text: string;
        } | {
            type: "box";
            id: string;
            properties: Record<string, unknown>;
            x: number;
            y: number;
            w: number;
            h: number;
        })[];
    }>;
    legacyImport: z.ZodOptional<z.ZodObject<{
        sourceFormat: z.ZodLiteral<"CircuitSpec">;
        groundSemantics: z.ZodLiteral<"global-ground">;
        terminalLabelSemantics: z.ZodLiteral<"local-labels-do-not-merge">;
        sourceMetadata: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strict", z.ZodTypeAny, {
        sourceFormat: "CircuitSpec";
        groundSemantics: "global-ground";
        terminalLabelSemantics: "local-labels-do-not-merge";
        sourceMetadata: Record<string, unknown>;
    }, {
        sourceFormat: "CircuitSpec";
        groundSemantics: "global-ground";
        terminalLabelSemantics: "local-labels-do-not-merge";
        sourceMetadata: Record<string, unknown>;
    }>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strict", z.ZodTypeAny, {
    schemaVersion: 2;
    id: string;
    electrical: {
        components: {
            type: CircuitDocumentComponentType;
            id: string;
            properties: Record<string, unknown>;
            pins: {
                id: string;
                name: string;
                number?: string | undefined;
                unit?: number | undefined;
                bodyStyle?: number | undefined;
                occurrence?: number | undefined;
                electricalType?: string | undefined;
            }[];
            value?: string | undefined;
            reference?: string | undefined;
        }[];
        nets: {
            id: string;
            members: {
                componentId: string;
                pinId: string;
            }[];
            name?: string | undefined;
            attributes?: Record<string, unknown> | undefined;
        }[];
        noConnects: {
            componentId: string;
            pinId: string;
        }[];
        unassignedPins: {
            componentId: string;
            pinId: string;
        }[];
    };
    drawing: {
        units: "px";
        canvas: {
            width?: number | undefined;
            height?: number | undefined;
        };
        placements: {
            properties: Record<string, unknown>;
            componentId: string;
            position: [number, number];
            rotation: number;
            flip: boolean;
            legacyGeometry?: {
                at?: [number, number] | undefined;
                from?: [number, number] | undefined;
                to?: [number, number] | undefined;
            } | undefined;
        }[];
        routes: {
            id: string;
            properties: Record<string, unknown>;
            netId: string;
            points: [number, number][];
            open?: boolean | undefined;
        }[];
        junctions: {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
        }[];
        crossings: {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
            orientation?: "horizontal" | "vertical" | undefined;
        }[];
        annotations: ({
            at: [number, number];
            type: "label";
            id: string;
            properties: Record<string, unknown>;
            text: string;
        } | {
            type: "box";
            id: string;
            properties: Record<string, unknown>;
            x: number;
            y: number;
            w: number;
            h: number;
        })[];
    };
    title?: string | undefined;
    legacyImport?: {
        sourceFormat: "CircuitSpec";
        groundSemantics: "global-ground";
        terminalLabelSemantics: "local-labels-do-not-merge";
        sourceMetadata: Record<string, unknown>;
    } | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    schemaVersion: 2;
    id: string;
    electrical: {
        components: {
            type: CircuitDocumentComponentType;
            id: string;
            properties: Record<string, unknown>;
            pins: {
                id: string;
                name: string;
                number?: string | undefined;
                unit?: number | undefined;
                bodyStyle?: number | undefined;
                occurrence?: number | undefined;
                electricalType?: string | undefined;
            }[];
            value?: string | undefined;
            reference?: string | undefined;
        }[];
        nets: {
            id: string;
            members: {
                componentId: string;
                pinId: string;
            }[];
            name?: string | undefined;
            attributes?: Record<string, unknown> | undefined;
        }[];
        noConnects: {
            componentId: string;
            pinId: string;
        }[];
        unassignedPins: {
            componentId: string;
            pinId: string;
        }[];
    };
    drawing: {
        units: "px";
        canvas: {
            width?: number | undefined;
            height?: number | undefined;
        };
        placements: {
            properties: Record<string, unknown>;
            componentId: string;
            position: [number, number];
            rotation: number;
            flip: boolean;
            legacyGeometry?: {
                at?: [number, number] | undefined;
                from?: [number, number] | undefined;
                to?: [number, number] | undefined;
            } | undefined;
        }[];
        routes: {
            id: string;
            properties: Record<string, unknown>;
            netId: string;
            points: [number, number][];
            open?: boolean | undefined;
        }[];
        junctions: {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
        }[];
        crossings: {
            at: [number, number];
            id: string;
            properties: Record<string, unknown>;
            routeIds: string[];
            orientation?: "horizontal" | "vertical" | undefined;
        }[];
        annotations: ({
            at: [number, number];
            type: "label";
            id: string;
            properties: Record<string, unknown>;
            text: string;
        } | {
            type: "box";
            id: string;
            properties: Record<string, unknown>;
            x: number;
            y: number;
            w: number;
            h: number;
        })[];
    };
    title?: string | undefined;
    legacyImport?: {
        sourceFormat: "CircuitSpec";
        groundSemantics: "global-ground";
        terminalLabelSemantics: "local-labels-do-not-merge";
        sourceMetadata: Record<string, unknown>;
    } | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export type CircuitDocumentV2 = z.infer<typeof CircuitDocumentV2Schema>;
export type CircuitComponentV2 = CircuitDocumentV2["electrical"]["components"][number];
export type CircuitNetV2 = CircuitDocumentV2["electrical"]["nets"][number];
export declare function isCircuitDocumentComponentType(value: unknown): value is CircuitDocumentComponentType;
/**
 * Returns pin IDs derived from the shared geometry catalog or the exact
 * selected KiCad symbol unit. No pin identities are invented for unresolved
 * symbols.
 */
export declare function getCircuitPinDefinitions(type: unknown, properties?: Record<string, unknown>): CircuitPinDefinition[] | null;
export declare function createCircuitComponent(input: Omit<CircuitComponentV2, "pins"> & {
    pins?: CircuitPinDefinition[];
}): CircuitComponentV2;
export declare function parseCircuitDocumentV2(value: unknown): CircuitDocumentV2;
export declare function serializeCircuitDocumentV2(value: unknown): string;
//# sourceMappingURL=model.d.ts.map