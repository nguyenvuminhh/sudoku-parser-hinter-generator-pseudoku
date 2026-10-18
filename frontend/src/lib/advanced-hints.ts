import type { HintResult } from "./hintEngine";
import { parsePuzzleText, validateSudokuGrid } from "./sudoku-state";

type Group = { nodes: number[]; label: string };
type Model = { groups: Group[]; memberships: number[][]; nodes: number[] };
type Step = { node: number; value: 1 | -1; rule: "assume" | "peer" | "only"; group: number | null; parents: number[] };
type Failure = { group: number; kind: "empty" | "multiple" };
type Branch = { root: number; steps: Step[]; failure: Failure | null };
export type ChainProof = { sourceGroup: number | null; branches: Branch[]; conclusion: { node: number; value: 1 | -1 } };
type Propagation = Branch & { states: Int8Array; eventForNode: Int32Array };

const cellOf = (node: number) => Math.floor(node / 9);
const digitOf = (node: number) => node % 9 + 1;
const cellName = (cell: number) => `R${Math.floor(cell / 9) + 1}C${cell % 9 + 1}`;
const nodeName = (node: number) => `${cellName(cellOf(node))} = ${digitOf(node)}`;

function buildModel(puzzle: string, candidates: string): Model {
  if (!/^[0-9.]{81}$/.test(puzzle)) throw new Error("invalid_format");
  const grid = parsePuzzleText(puzzle), validation = validateSudokuGrid(grid);
  if (!validation.valid) throw new Error("unsolvable");
  const segments = candidates ? candidates.split("|") : null;
  if (segments && (segments.length !== 81 || segments.some(segment => !/^[1-9]*$/.test(segment)))) throw new Error("invalid_format");
  const groups: Group[] = [], memberships: number[][] = Array.from({ length: 729 }, () => []), nodes: number[] = [];
  const cells = grid.map((value, cell) => {
    if (value !== null) return [];
    const legal = validation.candidates[String(cell)] ?? [];
    const digits = segments ? legal.filter(digit => segments[cell].includes(String(digit))) : legal;
    if (!digits.length) throw new Error("invalid_candidates");
    const result = digits.map(digit => cell * 9 + digit - 1);
    nodes.push(...result);
    return result;
  });
  const add = (members: number[], label: string) => {
    if (!members.length) throw new Error("invalid_candidates");
    const index = groups.length;
    groups.push({ nodes: members, label });
    for (const node of members) memberships[node].push(index);
  };
  cells.forEach((members, index) => { if (members.length) add(members, `cell ${cellName(index)}`); });
  for (const unit of ["row", "column", "box"] as const) for (let index = 0; index < 9; index++) {
    const indexes = Array.from({ length: 9 }, (_, offset) => unit === "row" ? index * 9 + offset
      : unit === "column" ? offset * 9 + index : Math.floor(index / 3) * 27 + (index % 3) * 3 + Math.floor(offset / 3) * 9 + offset % 3);
    for (let digit = 1; digit <= 9; digit++) {
      if (indexes.some(cell => grid[cell] === digit)) continue;
      add(indexes.flatMap(cell => cells[cell].filter(node => digitOf(node) === digit)), `digit ${digit} in ${unit} ${index + 1}`);
    }
  }
  return { groups, memberships, nodes };
}

/** Only exact-one implications: no recursive search or solution lookup. */
function propagate(model: Model, root: number): Propagation {
  const states = new Int8Array(729), eventForNode = new Int32Array(729).fill(-1);
  const steps: Step[] = [], queue = model.groups.map((_, index) => index);
  const assign = (step: Step) => {
    if (states[step.node]) return;
    states[step.node] = step.value;
    eventForNode[step.node] = steps.length;
    steps.push(step);
    queue.push(...model.memberships[step.node]);
  };
  assign({ node: root, value: 1, rule: "assume", group: null, parents: [] });
  for (let index = 0; index < queue.length; index++) {
    const groupId = queue[index], group = model.groups[groupId];
    const trueNodes = group.nodes.filter(node => states[node] === 1);
    const alive = group.nodes.filter(node => states[node] !== -1);
    if (!alive.length || trueNodes.length > 1) {
      return { root, steps, states, eventForNode, failure: { group: groupId, kind: alive.length ? "multiple" : "empty" } };
    }
    if (trueNodes.length === 1) {
      for (const node of alive) if (node !== trueNodes[0]) {
        assign({ node, value: -1, rule: "peer", group: groupId, parents: [eventForNode[trueNodes[0]]] });
      }
    } else if (alive.length === 1) {
      assign({ node: alive[0], value: 1, rule: "only", group: groupId,
        parents: group.nodes.filter(node => node !== alive[0]).map(node => eventForNode[node]) });
    }
  }
  return { root, steps, states, eventForNode, failure: null };
}

function evidence(model: Model, branch: Branch, target?: number): { lines: string[]; cells: number[] } {
  const eventForNode = new Map(branch.steps.map((step, index) => [step.node, index]));
  const pending = target === undefined
    ? model.groups[branch.failure!.group].nodes.map(node => eventForNode.get(node)).filter((index): index is number => index !== undefined)
    : [eventForNode.get(target)!];
  const needed = new Set<number>([0]);
  while (pending.length) {
    const event = pending.pop()!;
    if (needed.has(event)) continue;
    needed.add(event);
    pending.push(...branch.steps[event].parents);
  }
  const cells = new Set<number>();
  const lines = [...needed].sort((a, b) => a - b).map(index => {
    const step = branch.steps[index];
    cells.add(cellOf(step.node));
    if (step.rule === "assume") return `Assume ${nodeName(step.node)}.`;
    const group = model.groups[step.group!];
    if (step.rule === "peer") return `${nodeName(branch.steps[step.parents[0]].node)} rules out ${digitOf(step.node)} at ${cellName(cellOf(step.node))} (${group.label}).`;
    return `${nodeName(step.node)} is forced: it is the only remaining possibility for ${group.label}.`;
  });
  if (branch.failure) lines.push(`Contradiction: ${model.groups[branch.failure.group].label} ${branch.failure.kind === "empty" ? "has no remaining possibility" : "would have two values at once"}.`);
  return { lines, cells: [...cells] };
}

function result(model: Model, proof: ChainProof): HintResult {
  const { node, value } = proof.conclusion;
  const contradiction = proof.sourceGroup === null;
  const technique = contradiction ? "Contradiction Chain" : model.groups[proof.sourceGroup!].label.startsWith("cell") ? "Cell Forcing Chain" : "Region Forcing Chain";
  const description = value === 1 ? `${technique}: place ${digitOf(node)} in ${cellName(cellOf(node))}.`
    : `${technique}: remove ${digitOf(node)} from ${cellName(cellOf(node))}.`;
  const explanation = contradiction ? [] : [`Exactly one possibility for ${model.groups[proof.sourceGroup!].label} must be true. Check every case:`];
  const cells = new Set<number>();
  for (const branch of proof.branches) {
    const trace = evidence(model, branch, contradiction ? undefined : node);
    explanation.push(...trace.lines);
    trace.cells.forEach(cell => cells.add(cell));
  }
  explanation.push(contradiction ? `Therefore ${nodeName(node)} is impossible; remove this candidate.`
    : `Every case ${value === 1 ? "forces" : "rules out"} ${nodeName(node)}. ${description}`);
  return {
    technique, description, difficulty: contradiction ? 21 : proof.sourceGroup !== null && model.groups[proof.sourceGroup].label.startsWith("cell") ? 22 : 23,
    causalCells: [...cells], eliminationCells: value === -1 ? [cellOf(node)] : [],
    eliminations: value === -1 ? [{ cell: cellOf(node), digit: digitOf(node) }] : [],
    placement: value === 1 ? { cell: cellOf(node), digit: digitOf(node) } : null,
    explanation, proof: { ...proof, branches: proof.branches.map(({ root, steps, failure }) => ({ root, steps, failure })) }
  };
}

export function findAdvancedHint(puzzle: string, candidates = ""): HintResult | null {
  const model = buildModel(puzzle, candidates);
  if (!model.nodes.length) return null;
  const branches = new Map<number, Propagation>();
  let best: { proof: ChainProof; length: number } | null = null;
  for (const node of model.nodes) {
    const branch = propagate(model, node);
    branches.set(node, branch);
    if (branch.failure) {
      const proof: ChainProof = { sourceGroup: null, branches: [branch], conclusion: { node, value: -1 } };
      const length = evidence(model, branch).lines.length;
      if (!best || length < best.length) best = { proof, length };
    }
  }
  // If every possible value of an exact-one group contradicts the notes,
  // report inconsistent candidates instead of eliminating a true digit.
  if (model.groups.some(group => group.nodes.every(node => branches.get(node)!.failure))) throw new Error("invalid_candidates");
  if (best) return result(model, best.proof);
  for (let groupId = 0; groupId < model.groups.length; groupId++) {
    const group = model.groups[groupId];
    if (group.nodes.length < 2 || group.nodes.length > 4) continue;
    const cases = group.nodes.map(node => branches.get(node)!);
    for (const node of model.nodes) {
      if (group.nodes.includes(node)) continue;
      const value = cases[0].states[node];
      if (!value || !cases.every(branch => branch.states[node] === value)) continue;
      return result(model, { sourceGroup: groupId, branches: cases, conclusion: { node, value: value as 1 | -1 } });
    }
  }
  return null;
}

/** Replay certificates independently of the search, checking every implication. */
export function verifyChainProof(puzzle: string, candidates: string, hint: HintResult): boolean {
  try {
    const model = buildModel(puzzle, candidates), proof = hint.proof;
    if (!proof || !model.nodes.includes(proof.conclusion.node) || !proof.branches.length) return false;
    const { node, value } = proof.conclusion;
    if (value === 1 ? !hint.placement || hint.placement.cell !== cellOf(node) || hint.placement.digit !== digitOf(node) || hint.eliminations.length !== 0
      : hint.placement !== null || hint.eliminations.length !== 1 || hint.eliminations[0].cell !== cellOf(node) || hint.eliminations[0].digit !== digitOf(node)) return false;
    const statesByBranch: Int8Array[] = [];
    for (const branch of proof.branches) {
      const states = new Int8Array(729);
      if (!model.nodes.includes(branch.root) || branch.steps[0]?.rule !== "assume") return false;
      for (const [index, step] of branch.steps.entries()) {
        if (!model.nodes.includes(step.node) || states[step.node] || ![1, -1].includes(step.value)) return false;
        if (step.rule === "assume") {
          if (index !== 0 || step.node !== branch.root || step.value !== 1 || step.group !== null) return false;
        } else {
          const group = model.groups[step.group!];
          if (!group || !group.nodes.includes(step.node)) return false;
          if (step.rule === "peer") {
            if (step.value !== -1 || !group.nodes.some(other => other !== step.node && states[other] === 1)) return false;
          } else if (step.rule === "only") {
            if (step.value !== 1 || !group.nodes.every(other => other === step.node || states[other] === -1)) return false;
          } else return false;
        }
        states[step.node] = step.value;
      }
      if (branch.failure) {
        const group = model.groups[branch.failure.group];
        if (!group || (branch.failure.kind === "empty" ? !group.nodes.every(other => states[other] === -1)
          : group.nodes.filter(other => states[other] === 1).length < 2)) return false;
      }
      statesByBranch.push(states);
    }
    if (proof.sourceGroup === null) return proof.branches.length === 1 && value === -1 && proof.branches[0].root === node && proof.branches[0].failure !== null;
    const source = model.groups[proof.sourceGroup];
    return !!source && source.nodes.length === proof.branches.length && new Set(proof.branches.map(branch => branch.root)).size === source.nodes.length
      && source.nodes.every(root => proof.branches.some(branch => branch.root === root))
      && proof.branches.every(branch => !branch.failure) && statesByBranch.every(states => states[node] === value);
  } catch { return false; }
}
