import type { CircuitDocumentV2 } from './model.ts';
import type { CircuitLayoutHints } from './layout-types.ts';
export type CircuitLayoutTopologyGroup = {
    id: string;
    componentIds: string[];
    rankByComponent: Map<string, number>;
    order: string[];
};
export type CircuitLayoutTopology = {
    groups: CircuitLayoutTopologyGroup[];
    feedbackClusters: string[][];
    netsWithMoreThanTwoPins: number;
    excessFanout: number;
};
export declare function buildCircuitLayoutTopology(document: CircuitDocumentV2, hints: CircuitLayoutHints): CircuitLayoutTopology;
export declare function compareLayoutIds(left: string, right: string): number;
//# sourceMappingURL=layout-topology.d.ts.map