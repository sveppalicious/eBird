// regions.js -- the tree every page hangs off.
//
// Iceland, a sveitarfelag and a hverfi or postnumer are all just regions here:
// same record, same files, same page. The tree is what turns "one level deeper
// than eBird" into something the views never have to special-case.

const COUNTRY = 'IS';

function buildTree(list) {
  const byId = new Map(list.map(r => [r.id, r]));
  const kids = new Map();
  for (const r of list) {
    if (!r.parent) continue;
    if (!kids.has(r.parent)) kids.set(r.parent, []);
    kids.get(r.parent).push(r);
  }

  // A sveitarfelag covered by a single postal area is not subdivided: the one
  // "child" is the whole place again, so offering it as a deeper level would be
  // a link from a page to itself with a different heading. 16 of 61 are like
  // this.
  const children = id => {
    const k = kids.get(id) || [];
    return k.length > 1 ? k : [];
  };

  // Root first, the region itself last -- the breadcrumb, in order.
  const path = id => {
    const out = [];
    for (let r = byId.get(id); r; r = byId.get(r.parent)) out.unshift(r);
    return out;
  };

  return {
    byId, children, path,
    get: id => byId.get(id) || null,
    parent: id => { const r = byId.get(id); return r && r.parent ? byId.get(r.parent) : null; },
    // What the map draws around a leaf: the other children of its parent.
    siblings: id => { const r = byId.get(id); return r && r.parent ? children(r.parent) : []; },
    isLeaf: id => children(id).length === 0,
    all: () => list
  };
}

// The sveitarfelag a region belongs to: itself, or an area's parent. Null for
// the country.
function municipalityOf(tree, id) {
  const r = tree.get(id);
  if (!r || r.kind === 'country') return null;
  return (r.kind === 'hverfi' || r.kind === 'postnumer') ? r.parent : r.id;
}

// Other municipalities the same postal district reaches into. A district can
// straddle a boundary, and cutting it to the municipality is what keeps areas
// tiling their sveitarfelag -- so 660 Myvatn is three regions, legitimately,
// and each needs to be able to name the others.
function straddleSiblings(tree, id) {
  const r = tree.get(id);
  if (!r || r.kind !== 'postnumer') return [];
  return tree.all().filter(o =>
    o.kind === 'postnumer' && o.code === r.code && o.id !== r.id);
}

// Which regions a map of `id` is about, and which one is "here". A region with
// children shows them; a leaf shows itself among its siblings, so there is
// always something next door to click. `fit` is what the map frames.
function focusFor(tree, id) {
  const r = tree.get(id);
  if (!r) return { ids: [], selected: null, fit: null };
  const kids = tree.children(id);
  if (kids.length) return { ids: kids.map(k => k.id), selected: null, fit: id };
  const sibs = tree.siblings(id);
  return { ids: (sibs.length ? sibs : [r]).map(k => k.id), selected: id, fit: id };
}

export { COUNTRY, buildTree, municipalityOf, straddleSiblings, focusFor };
