// Conservative hierarchy matcher. Position is evidence, never enough to force a match.
export function matchComponents(reference, candidate) {
  const matches = [],
    usedR = new Set(),
    usedC = new Set();
  let seq = 0;
  function emit(r, c, status, confidence, reasons) {
    const m = {
      id: 'm' + seq++,
      referenceId: r?.id,
      candidateId: c?.id,
      status,
      confidence,
      reasons,
    };
    matches.push(m);
    if (r) usedR.add(r.id);
    if (c) usedC.add(c.id);
    return m;
  }
  function group(parentR, parentC) {
    const rs = reference.filter((x) => x.parentId === parentR),
      cs = candidate.filter((x) => x.parentId === parentC);
    for (const r of rs) {
      const options = cs.filter(
        (x) => !usedC.has(x.id) && x.type === r.type && x.heading === r.heading && r.heading,
      );
      const peers = rs.filter((x) => x.type === r.type && x.heading === r.heading);
      if (options.length === 1 && peers.length === 1) {
        const c = options[0];
        emit(r, c, 'matched', 0.98, [
          'type',
          'hierarchy',
          'unique heading',
          r.siblingIndex === c.siblingIndex ? 'same order' : 'reordered',
        ]);
        group(r.id, c.id);
      }
    }
    for (const r of rs.filter((x) => !usedR.has(x.id))) {
      const options = cs.filter((x) => !usedC.has(x.id) && x.type === r.type);
      const peers = rs.filter((x) => !usedR.has(x.id) && x.type === r.type);
      if (options.length === 1 && peers.length === 1) {
        const c = options[0];
        emit(r, c, 'matched', 0.9, ['unique type under matched parent']);
        group(r.id, c.id);
      }
    }
    for (const r of rs.filter((x) => !usedR.has(x.id))) {
      const options = cs.filter((x) => !usedC.has(x.id) && x.type === r.type);
      if (options.length) {
        emit(r, undefined, 'ambiguous', 0.4, ['repeated type without unique stable heading']);
      } else emit(r, undefined, 'removed', 0.95, ['no candidate under matched parent']);
    }
    for (const c of cs.filter((x) => !usedC.has(x.id))) {
      const ambiguous = rs.some(
        (r) =>
          r.type === c.type &&
          matches.some((m) => m.referenceId === r.id && m.status === 'ambiguous'),
      );
      emit(undefined, c, ambiguous ? 'ambiguous' : 'added', ambiguous ? 0.4 : 0.95, [
        ambiguous ? 'unresolved repeated type' : 'no reference under matched parent',
      ]);
    }
  }
  group(null, null);
  // Descendants of unresolved parents must not become independently confirmed changes.
  for (const r of reference.filter((x) => !usedR.has(x.id)))
    emit(r, undefined, 'ambiguous', 0.2, ['parent unresolved']);
  for (const c of candidate.filter((x) => !usedC.has(x.id)))
    emit(undefined, c, 'ambiguous', 0.2, ['parent unresolved']);
  return matches;
}
