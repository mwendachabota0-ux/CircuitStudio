import type {
  CircuitComponentV2,
  CircuitDocumentV2,
} from './model.ts';
import type { CircuitLayoutHints } from './layout-types.ts';

type Role = NonNullable<CircuitLayoutHints['componentRoles']>[string];

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

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function componentNode(id: string): string {
  return `component:${id}`;
}

function netNode(id: string): string {
  return `net:${id}`;
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  constructor(ids: string[]) {
    ids.forEach((id) => this.parent.set(id, id));
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent === undefined) return id;
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(first: string, second: string): void {
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);
    if (firstRoot === secondRoot) return;
    const [low, high] = compareIds(firstRoot, secondRoot) <= 0
      ? [firstRoot, secondRoot]
      : [secondRoot, firstRoot];
    this.parent.set(high, low);
  }
}

function inferredRole(component: CircuitComponentV2): Role {
  switch (component.type) {
    case 'battery':
    case 'dcsource':
    case 'currentsource':
      return 'source';
    case 'mic':
      return 'input';
    case 'speaker':
    case 'lamp':
      return 'output';
    case 'npn':
    case 'pnp':
    case 'nmos':
    case 'pmos':
    case 'mosfet':
    case 'njfet':
    case 'pjfet':
    case 'opamp':
    case 'comparator':
    case 'ic':
    case 'kicad':
      return 'active';
    default:
      return 'unknown';
  }
}

function roleFor(
  component: CircuitComponentV2,
  hints: CircuitLayoutHints,
): Role {
  return hints.componentRoles?.[component.id] ?? inferredRole(component);
}

function rolePriority(role: Role): number {
  switch (role) {
    case 'source':
    case 'input':
      return 0;
    case 'active':
      return 1;
    case 'unknown':
      return 2;
    case 'output':
      return 3;
  }
}

function graphLayers(
  groupComponentIds: string[],
  componentById: Map<string, CircuitComponentV2>,
  netComponents: Map<string, string[]>,
  componentNets: Map<string, string[]>,
  hints: CircuitLayoutHints,
): {
  rankByComponent: Map<string, number>;
  orderIndexByComponent: Map<string, number>;
  adjacency: Map<string, string[]>;
} {
  const groupSet = new Set(groupComponentIds);
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (first: string, second: string) => {
    const firstEdges = adjacency.get(first) ?? new Set<string>();
    firstEdges.add(second);
    adjacency.set(first, firstEdges);
    const secondEdges = adjacency.get(second) ?? new Set<string>();
    secondEdges.add(first);
    adjacency.set(second, secondEdges);
  };

  for (const componentId of groupComponentIds) {
    adjacency.set(componentNode(componentId), new Set());
  }
  for (const [netId, members] of [...netComponents.entries()].sort(([a], [b]) => compareIds(a, b))) {
    if (!members.some((componentId) => groupSet.has(componentId))) continue;
    const node = netNode(netId);
    adjacency.set(node, new Set());
    for (const componentId of members) {
      if (groupSet.has(componentId)) addEdge(componentNode(componentId), node);
    }
  }

  const roleSeedOrder = [...groupComponentIds].sort((left, right) => {
    const leftComponent = componentById.get(left)!;
    const rightComponent = componentById.get(right)!;
    const roleDifference = rolePriority(roleFor(leftComponent, hints)) -
      rolePriority(roleFor(rightComponent, hints));
    if (roleDifference) return roleDifference;
    const degreeDifference = (componentNets.get(right)?.length ?? 0) -
      (componentNets.get(left)?.length ?? 0);
    return degreeDifference || compareIds(left, right);
  });
  const root = componentNode(roleSeedOrder[0]);
  const distance = new Map<string, number>([[root, 0]]);
  const queue = [root];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    const nextDistance = distance.get(node)! + 1;
    const neighbors = [...(adjacency.get(node) ?? [])].sort(compareIds);
    for (const neighbor of neighbors) {
      if (distance.has(neighbor)) continue;
      distance.set(neighbor, nextDistance);
      queue.push(neighbor);
    }
  }

  const layers = new Map<number, string[]>();
  for (const [node, layer] of distance) {
    const layerNodes = layers.get(layer) ?? [];
    layerNodes.push(node);
    layers.set(layer, layerNodes);
  }
  for (const nodes of layers.values()) nodes.sort(compareIds);

  const orderInLayer = new Map<string, number>();
  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);
  for (const layer of sortedLayers) {
    (layers.get(layer) ?? []).forEach((node, index) => orderInLayer.set(node, index));
  }
  const sweep = (layer: number, neighborLayer: number) => {
    const neighborPositions = new Map<string, number>();
    (layers.get(neighborLayer) ?? []).forEach((node, index) => neighborPositions.set(node, index));
    const current = layers.get(layer) ?? [];
    const barycenters = new Map<string, number>();
    current.forEach((node) => {
      const neighborIndexes = [...(adjacency.get(node) ?? [])]
        .map((neighbor) => neighborPositions.get(neighbor))
        .filter((position): position is number => position !== undefined);
      if (neighborIndexes.length > 0) {
        barycenters.set(
          node,
          neighborIndexes.reduce((sum, value) => sum + value, 0) / neighborIndexes.length,
        );
      }
    });
    current.sort((left, right) => {
      const leftBarycenter = barycenters.get(left);
      const rightBarycenter = barycenters.get(right);
      if (leftBarycenter !== undefined && rightBarycenter !== undefined) {
        const delta = leftBarycenter - rightBarycenter;
        if (Math.abs(delta) > 1e-9) return delta;
      } else if (leftBarycenter !== undefined) {
        return -1;
      } else if (rightBarycenter !== undefined) {
        return 1;
      }
      return (orderInLayer.get(left) ?? 0) - (orderInLayer.get(right) ?? 0) ||
        compareIds(left, right);
    });
    current.forEach((node, index) => orderInLayer.set(node, index));
  };

  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 1; index < sortedLayers.length; index += 1) {
      sweep(sortedLayers[index], sortedLayers[index - 1]);
    }
    for (let index = sortedLayers.length - 2; index >= 0; index -= 1) {
      sweep(sortedLayers[index], sortedLayers[index + 1]);
    }
  }

  const rankByComponent = new Map<string, number>();
  const orderIndexByComponent = new Map<string, number>();
  for (const componentId of groupComponentIds) {
    const node = componentNode(componentId);
    rankByComponent.set(componentId, Math.floor((distance.get(node) ?? 0) / 2));
    orderIndexByComponent.set(componentId, orderInLayer.get(node) ?? 0);
  }
  return { rankByComponent, orderIndexByComponent, adjacency };
}

function pinFlow(
  component: CircuitComponentV2,
  pinId: string,
): 'input' | 'output' | 'passive' | 'bidirectional' | 'neutral' {
  const pin = component.pins.find((entry) => entry.id === pinId);
  const electricalType = pin?.electricalType?.toLowerCase().replace(/[\s-]+/g, '_');
  if (electricalType) {
    if (['input', 'power_in', 'open_collector'].includes(electricalType)) return 'input';
    if (['output', 'power_out'].includes(electricalType)) return 'output';
    if (['bidirectional', 'tri_state'].includes(electricalType)) return 'bidirectional';
    if (['passive', 'free', 'unspecified'].includes(electricalType)) return 'passive';
  }

  const normalizedId = pin?.name?.toLowerCase() ?? pinId.toLowerCase();
  if (component.type === 'npn' || component.type === 'pnp') {
    if (normalizedId === 'b' || normalizedId.includes('base')) return 'input';
    if (normalizedId === 'c' || normalizedId.includes('collector')) return 'output';
    if (normalizedId === 'e' || normalizedId.includes('emitter')) return 'output';
  }
  if (['nmos', 'pmos', 'mosfet', 'njfet', 'pjfet'].includes(component.type)) {
    if (normalizedId === 'g' || normalizedId.includes('gate')) return 'input';
    if (normalizedId === 'd' || normalizedId.includes('drain')) return 'output';
    if (normalizedId === 's' || normalizedId.includes('source')) return 'output';
  }
  if (component.type === 'opamp' || component.type === 'comparator') {
    if (normalizedId === 'inv' || normalizedId === 'noninv') return 'input';
    if (normalizedId === 'out') return 'output';
  }
  if (['diode', 'zener', 'led', 'photodiode', 'schottky'].includes(component.type)) {
    if (normalizedId === 'a' || normalizedId === '+') return 'input';
    if (normalizedId === 'k' || normalizedId === '-') return 'output';
  }
  if (['battery', 'dcsource', 'currentsource'].includes(component.type)) {
    if (normalizedId === '+' || normalizedId === 'plus') return 'output';
    return 'neutral';
  }
  if (component.type === 'ground') return 'input';

  if ([
    'resistor', 'capacitor', 'electrolytic', 'inductor', 'switch', 'fuse',
    'thermistor', 'photoresistor', 'varistor', 'speaker', 'lamp', 'acsource',
    'crystal', 'motor', 'buzzer', 'solarcell', 'mic',
  ].includes(component.type)) return 'passive';
  return 'neutral';
}

function stronglyConnectedFeedbackClusters(
  document: CircuitDocumentV2,
  hints: CircuitLayoutHints,
  nodeAdjacency: Map<string, Set<string>>,
): string[][] {
  const componentById = new Map(
    document.electrical.components.map((component) => [component.id, component]),
  );
  const componentByNet = new Map<string, Map<string, string[]>>();
  for (const net of document.electrical.nets) {
    const componentPins = new Map<string, string[]>();
    for (const member of net.members) {
      const pinIds = componentPins.get(member.componentId) ?? [];
      pinIds.push(member.pinId);
      componentPins.set(member.componentId, pinIds);
    }
    componentByNet.set(net.id, componentPins);
  }

  const graph = new Map<string, Set<string>>();
  const addDirectedEdge = (from: string, to: string) => {
    graph.set(from, graph.get(from) ?? new Set());
    graph.set(to, graph.get(to) ?? new Set());
    graph.get(from)!.add(to);
  };
  for (const component of [...document.electrical.components].sort((a, b) => compareIds(a.id, b.id))) {
    const node = componentNode(component.id);
    graph.set(node, new Set());
    const explicitRole = hints.componentRoles?.[component.id];
    const componentNetEntries = [...componentByNet.entries()]
      .filter(([netId, memberships]) =>
        memberships.has(component.id) &&
        hints.netRolesById?.[netId] !== 'power' &&
        hints.netRolesById?.[netId] !== 'return'
      )
      .sort(([left], [right]) => compareIds(left, right));
    const pinsByFlow = {
      input: [] as string[],
      output: [] as string[],
      passive: [] as string[],
      bidirectional: [] as string[],
    };
    for (const [netId, members] of componentNetEntries) {
      graph.set(netNode(netId), graph.get(netNode(netId)) ?? new Set());
      const pinIds = members.get(component.id) ?? [];
      for (const pinId of pinIds) {
        const flow = explicitRole === 'source' || explicitRole === 'input'
          ? 'output'
          : explicitRole === 'output'
            ? 'input'
            : pinFlow(component, pinId);
        if (flow !== 'neutral') pinsByFlow[flow].push(netId);
      }
    }
    const unique = (values: string[]) => [...new Set(values)].sort(compareIds);
    const inputNets = unique(pinsByFlow.input);
    const outputNets = unique(pinsByFlow.output);
    const passiveNets = unique(pinsByFlow.passive);
    const bidirectionalNets = unique(pinsByFlow.bidirectional);
    for (const netId of inputNets) addDirectedEdge(netNode(netId), node);
    for (const netId of outputNets) addDirectedEdge(node, netNode(netId));
    for (const netId of bidirectionalNets) {
      addDirectedEdge(netNode(netId), node);
      addDirectedEdge(node, netNode(netId));
    }
    const passiveNetworkNets = [...new Set([...passiveNets, ...bidirectionalNets])];
    if (passiveNetworkNets.length > 1) {
      for (const netId of passiveNetworkNets) {
        addDirectedEdge(netNode(netId), node);
        addDirectedEdge(node, netNode(netId));
      }
    }
  }

  for (const [node] of nodeAdjacency) {
    graph.set(node, graph.get(node) ?? new Set());
  }
  const nodes = [...graph.keys()].sort(compareIds);
  const visited = new Set<string>();
  const finishingOrder: string[] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: Array<{ node: string; neighbors: string[]; next: number }> = [{
      node: start,
      neighbors: [...(graph.get(start) ?? [])].sort(compareIds),
      next: 0,
    }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.next < frame.neighbors.length) {
        const neighbor = frame.neighbors[frame.next++];
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push({
          node: neighbor,
          neighbors: [...(graph.get(neighbor) ?? [])].sort(compareIds),
          next: 0,
        });
      } else {
        finishingOrder.push(frame.node);
        stack.pop();
      }
    }
  }

  const reverse = new Map<string, Set<string>>(nodes.map((node) => [node, new Set()]));
  for (const [from, neighbors] of graph) {
    for (const to of neighbors) reverse.get(to)!.add(from);
  }
  const assigned = new Set<string>();
  const clusters: string[][] = [];
  for (const start of finishingOrder.reverse()) {
    if (assigned.has(start)) continue;
    assigned.add(start);
    const componentNodes: string[] = [];
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.startsWith('component:')) componentNodes.push(node.slice('component:'.length));
      for (const neighbor of [...(reverse.get(node) ?? [])].sort(compareIds).reverse()) {
        if (assigned.has(neighbor)) continue;
        assigned.add(neighbor);
        stack.push(neighbor);
      }
    }
    const componentIds = componentNodes.sort(compareIds);
    if (componentIds.length > 1) clusters.push(componentIds);
  }
  return clusters.sort((left, right) => compareIds(left[0], right[0]));
}

export function buildCircuitLayoutTopology(
  document: CircuitDocumentV2,
  hints: CircuitLayoutHints,
): CircuitLayoutTopology {
  const components = [...document.electrical.components].sort((a, b) => compareIds(a.id, b.id));
  const componentById = new Map(components.map((component) => [component.id, component]));
  const componentNets = new Map<string, string[]>(
    components.map((component) => [component.id, []]),
  );
  const netComponents = new Map<string, string[]>();
  const set = new DisjointSet(components.map(({ id }) => id));

  const nets = [...document.electrical.nets].sort((a, b) => compareIds(a.id, b.id));
  for (const net of nets) {
    const members = [...new Set(net.members.map(({ componentId }) => componentId))]
      .filter((id) => componentById.has(id))
      .sort(compareIds);
    netComponents.set(net.id, members);
    for (const componentId of members) {
      componentNets.get(componentId)!.push(net.id);
    }
    for (let index = 1; index < members.length; index += 1) {
      set.union(members[0], members[index]);
    }
  }

  const grouped = new Map<string, string[]>();
  for (const component of components) {
    const root = set.find(component.id);
    const members = grouped.get(root) ?? [];
    members.push(component.id);
    grouped.set(root, members);
  }
  const componentGroups = [...grouped.values()]
    .map((componentIds) => componentIds.sort(compareIds))
    .sort((left, right) => compareIds(left[0], right[0]));

  const nodeAdjacency = new Map<string, Set<string>>();
  for (const [componentId, incidentNets] of componentNets) {
    const node = componentNode(componentId);
    nodeAdjacency.set(node, new Set(incidentNets.map(netNode)));
  }
  for (const [netId, memberIds] of netComponents) {
    const node = netNode(netId);
    nodeAdjacency.set(node, new Set(memberIds.map(componentNode)));
  }

  const feedbackClusters = stronglyConnectedFeedbackClusters(document, hints, nodeAdjacency);
  const feedbackClusterByComponent = new Map<string, string>();
  for (const cluster of feedbackClusters) {
    for (const componentId of cluster) feedbackClusterByComponent.set(componentId, cluster[0]);
  }

  const groups = componentGroups.map((componentIds) => {
    const layers = graphLayers(
      componentIds,
      componentById,
      netComponents,
      componentNets,
      hints,
    );
    for (const cluster of feedbackClusters) {
      const members = cluster.filter((componentId) => componentIds.includes(componentId));
      if (members.length < 2) continue;
      const rank = Math.min(...members.map((componentId) => layers.rankByComponent.get(componentId) ?? 0));
      for (const componentId of members) layers.rankByComponent.set(componentId, rank);
    }
    const order = [...componentIds].sort((left, right) => {
      const rankDifference = (layers.rankByComponent.get(left) ?? 0) -
        (layers.rankByComponent.get(right) ?? 0);
      if (rankDifference) return rankDifference;
      const leftFeedback = feedbackClusterByComponent.get(left) ?? '';
      const rightFeedback = feedbackClusterByComponent.get(right) ?? '';
      const feedbackDifference = compareIds(leftFeedback, rightFeedback);
      if (feedbackDifference) return feedbackDifference;
      const orderDifference = (layers.orderIndexByComponent.get(left) ?? 0) -
        (layers.orderIndexByComponent.get(right) ?? 0);
      if (orderDifference) return orderDifference;
      return compareIds(left, right);
    });
    return {
      id: componentIds[0],
      componentIds,
      rankByComponent: layers.rankByComponent,
      order,
    };
  });

  return {
    groups,
    feedbackClusters,
    netsWithMoreThanTwoPins: nets.filter((net) => net.members.length > 2).length,
    excessFanout: nets.reduce((sum, net) => sum + Math.max(0, net.members.length - 2), 0),
  };
}

export function compareLayoutIds(left: string, right: string): number {
  return compareIds(left, right);
}
