export type ElementType =
  | "R"
  | "V"
  | "I"
  | "VCVS"
  | "VCCS"
  | "CCVS"
  | "CCCS";

export interface CircuitElement {
  name: string;
  type: ElementType;
  p: string;
  n: string;
  value: number | null;
  control: string;
}

export interface ElementResult {
  element: CircuitElement;
  voltage: number;
  current: number;
  power: number;
}

export interface Solution {
  nodes: string[];
  voltages: Record<string, number>;
  elements: ElementResult[];
  equations: string[];
}

export interface TheveninResult {
  a: string;
  b: string;
  vTh: number;
  rTh: number;
  iNorton: number | null;
}

export interface MaximumPowerResult {
  possible: boolean;
  reason?: string;
  loadResistance?: number;
  maxPower?: number;
  loadVoltage?: number;
  loadCurrent?: number;
}

export interface MeshSolution {
  equations: string[];
  currents: number[];
  elementCurrents: Record<string, number>;
}

const TYPES: ElementType[] = ["R", "V", "I", "VCVS", "VCCS", "CCVS", "CCCS"];
const INDEPENDENT_SOURCES: ElementType[] = ["V", "I"];
const BRANCH_TYPES: ElementType[] = ["V", "VCVS", "CCVS"];
const MULTIPLIERS: Record<string, number> = {
  G: 1e9,
  k: 1e3,
  M: 1e6,
  m: 1e-3,
  u: 1e-6,
  "µ": 1e-6,
  n: 1e-9,
  p: 1e-12,
};

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toPrecision(6)));
}

export function parseValue(input: string): number {
  const match =
    /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([GkMmunpµ]?)\s*$/.exec(
      input,
    );
  if (!match) {
    throw new Error(`Invalid value: “${input}”. Use a number such as 4.7k.`);
  }
  const value = Number.parseFloat(match[1]) * (MULTIPLIERS[match[2]] ?? 1);
  if (!Number.isFinite(value)) throw new Error("Values must be finite numbers.");
  return value;
}

function checkedElements(elements: CircuitElement[]): Map<string, CircuitElement> {
  if (!elements.length) throw new Error("Add at least one circuit element.");
  const byName = new Map<string, CircuitElement>();

  for (const element of elements) {
    const name = element.name.trim();
    if (!name) throw new Error("Every element needs a name.");
    if (byName.has(name)) throw new Error(`Duplicate element name: ${name}.`);
    if (!TYPES.includes(element.type)) {
      throw new Error(`${name}: unsupported element type.`);
    }
    if (!element.p.trim() || !element.n.trim()) {
      throw new Error(`${name}: both connection nodes are required.`);
    }
    if (element.value === null || !Number.isFinite(element.value)) {
      throw new Error(`${name}: enter a value before solving.`);
    }
    if (element.type === "R" && element.value === 0) {
      throw new Error(`${name}: resistance cannot be zero.`);
    }
    byName.set(name, element);
  }
  return byName;
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  if (size === 0) return [];

  const work = matrix.map((row, index) => [...row, rhs[index]]);
  const scale = Math.max(0, ...matrix.flat().map(Math.abs));
  const tolerance = Math.max(Number.MIN_VALUE, scale * 1e-14);

  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(work[pivot][column]) <= tolerance) {
      throw new Error(
        "This circuit cannot be solved. Check that it has a ground node 0 and no floating nodes or conflicting ideal voltage sources.",
      );
    }

    [work[column], work[pivot]] = [work[pivot], work[column]];
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = work[row][column] / work[column][column];
      if (factor === 0) continue;
      for (let index = column; index <= size; index++) {
        work[row][index] -= factor * work[column][index];
      }
    }
  }

  const result = work.map((row, index) => row[size] / row[index]);
  if (result.some((value) => !Number.isFinite(value))) {
    throw new Error("The solver produced a non-finite result. Check your values.");
  }
  return result;
}

export function solveCircuit(elements: CircuitElement[]): Solution {
  const byName = checkedElements(elements);
  const nodes = [
    ...new Set(elements.flatMap((element) => [element.p.trim(), element.n.trim()])),
  ].filter((node) => node !== "0");
  const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
  const nodeColumn = (node: string): number => {
    const normalized = node.trim();
    if (normalized === "0") return -1;
    const index = nodeIndex.get(normalized);
    if (index === undefined) {
      throw new Error(`Node “${normalized}” is not connected in the circuit.`);
    }
    return index;
  };
  const branches = elements.filter((element) => BRANCH_TYPES.includes(element.type));
  const branchIndex = new Map(
    branches.map((element, index) => [element.name, nodes.length + index]),
  );
  const size = nodes.length + branches.length;
  const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const rhs = Array<number>(size).fill(0);
  const add = (row: number, column: number, value: number) => {
    if (row >= 0 && column >= 0) matrix[row][column] += value;
  };

  const currentControl = (
    element: CircuitElement,
  ): Array<[number, number]> => {
    const control = byName.get(element.control.trim());
    if (!control) {
      throw new Error(
        `${element.name}: control element “${element.control}” was not found.`,
      );
    }
    if (control.type === "R") {
      return [
        [nodeColumn(control.p), 1 / control.value!],
        [nodeColumn(control.n), -1 / control.value!],
      ];
    }
    if (control.type === "V") {
      const index = branchIndex.get(control.name);
      if (index !== undefined) return [[index, 1]];
    }
    throw new Error(
      `${element.name}: current control must be a resistor or an independent voltage source.`,
    );
  };

  const voltageControl = (element: CircuitElement): [number, number] => {
    const controlNodes = element.control.split(",").map((node) => node.trim());
    if (controlNodes.length !== 2 || controlNodes.some((node) => !node)) {
      throw new Error(`${element.name}: enter two control nodes, such as “2,0”.`);
    }
    return [nodeColumn(controlNodes[0]), nodeColumn(controlNodes[1])];
  };

  for (const element of elements) {
    const p = nodeColumn(element.p);
    const n = nodeColumn(element.n);
    const value = element.value!;
    const branch = branchIndex.get(element.name);

    if (element.type === "R") {
      const conductance = 1 / value;
      add(p, p, conductance);
      add(n, n, conductance);
      add(p, n, -conductance);
      add(n, p, -conductance);
    } else if (element.type === "I") {
      if (p >= 0) rhs[p] -= value;
      if (n >= 0) rhs[n] += value;
    } else if (element.type === "VCCS") {
      const [controlP, controlN] = voltageControl(element);
      add(p, controlP, value);
      add(p, controlN, -value);
      add(n, controlP, -value);
      add(n, controlN, value);
    } else if (element.type === "CCCS") {
      for (const [column, coefficient] of currentControl(element)) {
        add(p, column, value * coefficient);
        add(n, column, -value * coefficient);
      }
    } else {
      if (branch === undefined) {
        throw new Error(`${element.name}: internal branch setup failed.`);
      }
      add(p, branch, 1);
      add(n, branch, -1);
      add(branch, p, 1);
      add(branch, n, -1);

      if (element.type === "V") {
        rhs[branch] = value;
      } else if (element.type === "VCVS") {
        const [controlP, controlN] = voltageControl(element);
        add(branch, controlP, -value);
        add(branch, controlN, value);
      } else {
        for (const [column, coefficient] of currentControl(element)) {
          add(branch, column, -value * coefficient);
        }
      }
    }
  }

  const equations = matrix.map((row, rowIndex) => {
    const terms = row
      .map((coefficient, column) => ({ coefficient, column }))
      .filter(({ coefficient }) => coefficient !== 0)
      .map(({ coefficient, column }, index) => {
        const variable =
          column < nodes.length
            ? `V${nodes[column]}`
            : `i(${branches[column - nodes.length].name})`;
        const sign = coefficient < 0 ? "− " : index > 0 ? "+ " : "";
        const magnitude = Math.abs(coefficient);
        return `${sign}${magnitude === 1 ? "" : `${formatNumber(magnitude)} `}${variable}`;
      })
      .join(" ");
    const label =
      rowIndex < nodes.length
        ? `KCL at node ${nodes[rowIndex]}`
        : `Voltage equation for ${branches[rowIndex - nodes.length].name}`;
    return `${label}: ${terms || "0"} = ${formatNumber(rhs[rowIndex])}`;
  });

  const values = solveLinearSystem(matrix, rhs);
  const voltage = (node: string): number => {
    const normalized = node.trim();
    if (normalized === "0") return 0;
    const index = nodeIndex.get(normalized);
    if (index === undefined) {
      throw new Error(`Node “${normalized}” is not connected in the circuit.`);
    }
    return values[index];
  };

  const results = elements.map((element): ElementResult => {
    const elementVoltage = voltage(element.p) - voltage(element.n);
    let current: number;
    if (element.type === "R") {
      current = elementVoltage / element.value!;
    } else if (element.type === "I") {
      current = element.value!;
    } else if (element.type === "VCCS") {
      const [controlP, controlN] = voltageControl(element);
      const controlVoltage =
        (controlP < 0 ? 0 : values[controlP]) -
        (controlN < 0 ? 0 : values[controlN]);
      current = element.value! * controlVoltage;
    } else if (element.type === "CCCS") {
      current =
        element.value! *
        currentControl(element).reduce(
          (total, [column, coefficient]) =>
            total + (column < 0 ? 0 : coefficient * values[column]),
          0,
        );
    } else {
      current = values[branchIndex.get(element.name)!];
    }
    return {
      element,
      voltage: elementVoltage,
      current,
      power: elementVoltage * current,
    };
  });

  return {
    nodes,
    voltages: Object.fromEntries(nodes.map((node) => [node, voltage(node)])),
    elements: results,
    equations,
  };
}

export function findThevenin(
  elements: CircuitElement[],
  loadName?: string,
  terminals?: { a: string; b: string },
): TheveninResult {
  const load = loadName
    ? elements.find((element) => element.name === loadName)
    : undefined;
  if (loadName && !load) throw new Error(`Load element “${loadName}” was not found.`);
  const a = (load?.p ?? terminals?.a ?? "").trim();
  const b = (load?.n ?? terminals?.b ?? "").trim();
  if (!a || !b) {
    throw new Error("Choose a load element or enter both terminals a and b.");
  }
  const remaining = load
    ? elements.filter((element) => element.name !== load.name)
    : elements;
  const openCircuit = solveCircuit(remaining);
  const vTh = getVoltage(openCircuit, a) - getVoltage(openCircuit, b);
  const testName = uniqueName(remaining, "Itest");
  const deactivated = remaining.map((element) =>
    INDEPENDENT_SOURCES.includes(element.type)
      ? { ...element, value: 0 }
      : element,
  );
  const testSolution = solveCircuit([
    ...deactivated,
    { name: testName, type: "I", p: b, n: a, value: 1, control: "" },
  ]);
  const rTh = getVoltage(testSolution, a) - getVoltage(testSolution, b);
  return {
    a,
    b,
    vTh,
    rTh,
    iNorton: Math.abs(rTh) < 1e-12 ? null : vTh / rTh,
  };
}

function getVoltage(solution: Solution, node: string): number {
  if (node.trim() === "0") return 0;
  const value = solution.voltages[node.trim()];
  if (value === undefined) {
    throw new Error(`Terminal node “${node}” is not connected after removing the load.`);
  }
  return value;
}

function uniqueName(elements: CircuitElement[], prefix: string): string {
  const names = new Set(elements.map((element) => element.name));
  let candidate = prefix;
  let suffix = 1;
  while (names.has(candidate)) candidate = `${prefix}${suffix++}`;
  return candidate;
}

export function maximumPower(vTh: number, rTh: number): MaximumPowerResult {
  if (!(rTh > 0)) {
    return {
      possible: false,
      reason: `Maximum power transfer needs positive Rth (currently ${formatNumber(rTh)} Ω).`,
    };
  }
  if (Math.abs(vTh) < 1e-12) {
    return {
      possible: false,
      reason: "Maximum load power is zero because the Thevenin voltage is zero.",
    };
  }
  return {
    possible: true,
    loadResistance: rTh,
    maxPower: (vTh * vTh) / (4 * rTh),
    loadVoltage: vTh / 2,
    loadCurrent: vTh / (2 * rTh),
  };
}

export function solveWithLoad(
  elements: CircuitElement[],
  loadName: string,
  value: number,
): Solution {
  const load = elements.find((element) => element.name === loadName);
  if (!load) throw new Error(`Load element “${loadName}” was not found.`);
  if (load.type !== "R") throw new Error("The load must be a resistor.");
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new Error("The new load resistance must be greater than zero.");
  }
  return solveCircuit(
    elements.map((element) =>
      element.name === loadName ? { ...element, value } : element,
    ),
  );
}

interface MeshEquation {
  coefficients: number[];
  rhs: number;
  meshIds: number[];
  source?: string;
}

export function solveMeshes(
  elements: CircuitElement[],
  description: string,
): MeshSolution {
  const byName = checkedElements(elements);
  for (const element of elements) {
    if (!["R", "V", "I"].includes(element.type)) {
      throw new Error("Mesh analysis supports only R, V, and I elements.");
    }
    if (/\s/.test(element.name)) {
      throw new Error("Mesh analysis requires element names without spaces.");
    }
  }
  const lines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("Describe at least one mesh.");

  const meshes = lines.map((line, meshIndex) => {
    const body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
    const entries = new Map<string, number>();
    for (const token of body.trim().split(/\s+/).filter(Boolean)) {
      const sign = token.endsWith("-") ? -1 : 1;
      const name = token.replace(/[+-]$/, "");
      if (!byName.has(name)) throw new Error(`Unknown element in mesh: ${name}.`);
      if (entries.has(name)) {
        throw new Error(`Mesh ${meshIndex + 1} lists ${name} more than once.`);
      }
      entries.set(name, sign);
    }
    if (!entries.size) throw new Error(`Mesh ${meshIndex + 1} is empty.`);
    return entries;
  });
  const count = meshes.length;
  const meshRows: MeshEquation[] = meshes.map((mesh, meshIndex) => {
    const coefficients = Array<number>(count).fill(0);
    let rhs = 0;
    for (const [name, sign] of mesh) {
      const element = byName.get(name)!;
      if (element.type === "R") {
        for (let other = 0; other < count; other++) {
          const otherSign = meshes[other].get(name);
          if (otherSign !== undefined) {
            coefficients[other] += sign * otherSign * element.value!;
          }
        }
      } else if (element.type === "V") {
        rhs -= sign * element.value!;
      }
    }
    return { coefficients, rhs, meshIds: [meshIndex] };
  });

  const constraints: MeshEquation[] = [];
  const parent = Array.from({ length: count }, (_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };

  for (const element of elements.filter((candidate) => candidate.type === "I")) {
    const members = meshes
      .map((mesh, index) => ({ index, sign: mesh.get(element.name) }))
      .filter((entry): entry is { index: number; sign: number } => entry.sign !== undefined);
    if (!members.length) continue;
    if (members.length > 2) {
      throw new Error(`${element.name} appears in more than two meshes.`);
    }
    const coefficients = Array<number>(count).fill(0);
    members.forEach(({ index, sign }) => (coefficients[index] = sign));
    constraints.push({
      coefficients,
      rhs: element.value!,
      meshIds: members.map(({ index }) => index),
      source: element.name,
    });
    if (members.length === 2) {
      const first = root(members[0].index);
      const second = root(members[1].index);
      if (first !== second) parent[second] = first;
    }
  }

  const groups = new Map<number, number[]>();
  for (let index = 0; index < count; index++) {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  }
  const equations: MeshEquation[] = [];

  for (const group of groups.values()) {
    const groupSet = new Set(group);
    const groupConstraints = constraints.filter((constraint) =>
      constraint.meshIds.some((mesh) => groupSet.has(mesh)),
    );
    if (!groupConstraints.length) {
      group.forEach((mesh) => equations.push(meshRows[mesh]));
    } else if (group.length > 1) {
      const coefficients = Array<number>(count).fill(0);
      let rhs = 0;
      group.forEach((mesh) => {
        meshRows[mesh].coefficients.forEach((value, index) => {
          coefficients[index] += value;
        });
        rhs += meshRows[mesh].rhs;
      });
      equations.push({ coefficients, rhs, meshIds: [...group] });
    }
  }
  equations.push(...constraints);

  if (equations.length !== count) {
    throw new Error(
      `Mesh setup produces ${equations.length} equations for ${count} mesh currents. Check the loops and current-source directions.`,
    );
  }

  const currents = solveLinearSystem(
    equations.map((equation) => equation.coefficients),
    equations.map((equation) => equation.rhs),
  );
  const elementCurrents: Record<string, number> = {};
  const usedNames = new Set(meshes.flatMap((mesh) => [...mesh.keys()]));
  for (const name of usedNames) {
    elementCurrents[name] = meshes.reduce(
      (total, mesh, index) => total + (mesh.get(name) ?? 0) * currents[index],
      0,
    );
  }
  return {
    equations: equations.map((equation) => {
      const label = equation.source
        ? `Current source ${equation.source}`
        : equation.meshIds.length > 1
          ? `Supermesh ${equation.meshIds.map((id) => `i${id + 1}`).join(", ")}`
          : `KVL mesh i${equation.meshIds[0] + 1}`;
      const terms = equation.coefficients
        .map((coefficient, index) => ({ coefficient, index }))
        .filter(({ coefficient }) => coefficient !== 0)
        .map(({ coefficient, index }, position) => {
          const sign = coefficient < 0 ? "− " : position > 0 ? "+ " : "";
          const magnitude = Math.abs(coefficient);
          return `${sign}${magnitude === 1 ? "" : `${formatNumber(magnitude)} `}i${index + 1}`;
        })
        .join(" ");
      return `${label}: ${terms || "0"} = ${formatNumber(equation.rhs)}`;
    }),
    currents,
    elementCurrents,
  };
}
