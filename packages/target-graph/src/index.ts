export interface TargetNode {
  id: string;
  deps: string[];
}

/**
 * Kahn's algorithm. Returns nodes in topological order; ties broken by input order
 * (stable). Unknown dep ids are silently dropped (treated as already-built).
 * Throws on a cycle, naming the involved nodes.
 */
export function topologicalOrder<T extends TargetNode>(nodes: T[]): T[] {
  const byId = new Map<string, T>(nodes.map((n) => [n.id, n]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const n of nodes) {
    indegree.set(n.id, 0);
    dependents.set(n.id, []);
  }
  for (const n of nodes) {
    for (const dep of n.deps) {
      if (!byId.has(dep)) continue;
      indegree.set(n.id, (indegree.get(n.id) ?? 0) + 1);
      dependents.get(dep)!.push(n.id);
    }
  }

  const queue: string[] = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const out: T[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(byId.get(id)!);
    for (const dep of dependents.get(id) ?? []) {
      const newIn = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, newIn);
      if (newIn === 0) queue.push(dep);
    }
  }

  if (out.length !== nodes.length) {
    const stuck = nodes.filter((n) => !out.includes(n)).map((n) => n.id);
    throw new Error(`Dependency cycle among targets: ${stuck.join(", ")}`);
  }
  return out;
}

/**
 * Group nodes by dependency depth. Tier 0 = nodes with no deps; tier N = nodes
 * whose deepest in-graph dep is in tier N-1. A node with multiple deps lands
 * in the tier AFTER its deepest dep. Unknown dep ids are silently dropped
 * (treated as already-built). Throws on a cycle.
 *
 * Within a tier, nodes are mutually independent and can be built in parallel.
 */
export function topologicalTiers<T extends TargetNode>(nodes: T[]): T[][] {
  const byId = new Map<string, T>(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  function computeDepth(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) {
      throw new Error(`Dependency cycle among targets: ${id}`);
    }
    const node = byId.get(id);
    if (!node) return -1; // unknown dep — treat as already-built
    visiting.add(id);
    let maxDepDepth = -1;
    for (const dep of node.deps) {
      const d = computeDepth(dep);
      if (d > maxDepDepth) maxDepDepth = d;
    }
    visiting.delete(id);
    const myDepth = maxDepDepth + 1;
    depth.set(id, myDepth);
    return myDepth;
  }

  try {
    for (const n of nodes) computeDepth(n.id);
  } catch (e) {
    const remaining = nodes.filter((n) => !depth.has(n.id)).map((n) => n.id);
    if (remaining.length > 0) {
      throw new Error(`Dependency cycle among targets: ${remaining.join(", ")}`);
    }
    throw e;
  }

  const tiers: T[][] = [];
  for (const n of nodes) {
    const d = depth.get(n.id)!;
    while (tiers.length <= d) tiers.push([]);
    tiers[d]!.push(n);
  }
  return tiers;
}
