import {
  CIRCUIT_GEOMETRY_COMPATIBILITY_PROPERTY_KEYS,
  resolveCircuitComponentGeometry,
  type CircuitElementGeometry,
  type CircuitGeometryResolution,
} from '@workspace/circuit-geometry';
import type {
  CircuitComponentV2,
  CircuitDocumentV2,
} from './model.ts';

type CircuitPlacementV2 = CircuitDocumentV2['drawing']['placements'][number];

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]));
  }
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && sameValue(leftRecord[key], rightRecord[key])
    );
}

function authoritativeGeometryValue(
  component: CircuitComponentV2,
  placement: CircuitPlacementV2,
  key: (typeof CIRCUIT_GEOMETRY_COMPATIBILITY_PROPERTY_KEYS)[number],
): { present: boolean; value: unknown } {
  if (key === 'from' || key === 'to') {
    const legacyValue = placement.legacyGeometry?.[key];
    if (legacyValue !== undefined) return { present: true, value: legacyValue };
    return {
      present: hasOwn(component.properties, key),
      value: component.properties[key],
    };
  }
  if (key === 'at') {
    return {
      present: true,
      value: placement.legacyGeometry?.at ?? placement.position,
    };
  }
  if (key === 'rotation') return { present: true, value: placement.rotation };
  if (key === 'flip') return { present: true, value: placement.flip };
  return {
    present: hasOwn(component.properties, key),
    value: component.properties[key],
  };
}

/**
 * Resolve geometry from canonical component data and placement fields only.
 * placement.properties is intentionally not spread into this source object.
 */
export function createCircuitGeometryElement(
  component: CircuitComponentV2,
  placement: CircuitPlacementV2,
): CircuitElementGeometry {
  const properties = component.properties;
  const placementTextProperties = Object.fromEntries(
    ['labelAt', 'labelPos', 'labelNudge', 'labelAnchor']
      .filter((key) => hasOwn(placement.properties, key))
      .map((key) => [key, placement.properties[key]]),
  );
  return {
    ...properties,
    ...placementTextProperties,
    type: component.type,
    from: placement.legacyGeometry?.from ?? properties.from,
    to: placement.legacyGeometry?.to ?? properties.to,
    at: placement.legacyGeometry?.at ?? placement.position,
    flip: placement.flip,
    rotation: placement.rotation,
    label: component.reference ?? properties.label,
    value: component.value ?? properties.value,
  };
}

export function resolveCircuitDocumentComponentGeometry(
  component: CircuitComponentV2,
  placement: CircuitPlacementV2,
): CircuitGeometryResolution {
  return resolveCircuitComponentGeometry(
    createCircuitGeometryElement(component, placement),
  );
}

/**
 * Identifies attempted shadow copies of geometry properties. The canonical
 * value comes from component data, legacyGeometry, or explicit placement
 * transform fields; placement.properties is never a geometry authority.
 */
export function getPlacementGeometryPropertyConflicts(
  component: CircuitComponentV2,
  placement: CircuitPlacementV2,
): string[] {
  return CIRCUIT_GEOMETRY_COMPATIBILITY_PROPERTY_KEYS.filter((key) => {
    if (!hasOwn(placement.properties, key)) return false;
    const canonical = authoritativeGeometryValue(component, placement, key);
    return !canonical.present ||
      !sameValue(placement.properties[key], canonical.value);
  });
}
