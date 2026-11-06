import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentSection,
  destinationPage,
  expandedBranches,
  flattenOutline,
  resolveOutline,
  revealSection,
  toggleBranch,
  visibleRows,
} from '../../src/reading/outline.ts';

// A document of 10 pages. Page references are objects, as in a PDF; named destinations
// are looked up by name, as PDF.js does with getDestination.
const refs = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`r${i}`, { num: i, gen: 0 }]),
);
const source = {
  numPages: 10,
  async getDestination(name) {
    return (
      {
        intro: [refs.r0, { name: 'Fit' }],
        late: [refs.r8, { name: 'Fit' }],
        broken: 'not an array',
        bad: [{ num: 99, gen: 0 }, { name: 'Fit' }],
      }[name] ?? null
    );
  },
  async getPageIndex(ref) {
    const index = Object.values(refs).indexOf(ref);
    if (index < 0) throw new Error('Invalid page reference');
    return index;
  },
};

test('a destination is a page: explicit, by reference, by index or by name', async () => {
  assert.equal(await destinationPage(source, [refs.r3, { name: 'XYZ' }]), 4);
  assert.equal(
    await destinationPage(source, [2, { name: 'Fit' }]),
    3,
    'A page index, as in a link',
  );
  assert.equal(await destinationPage(source, 'intro'), 1);
  assert.equal(await destinationPage(source, 'late'), 9);
});

test('a broken, external or out-of-range destination has no page and is not an error', async () => {
  for (const dest of [null, undefined, 7, {}, [], [null], [{ num: 99, gen: 0 }], 'broken', 'bad'])
    assert.equal(await destinationPage(source, dest), null, JSON.stringify(dest));
  for (const dest of [[10], [-1], [1.5], ['1']])
    assert.equal(await destinationPage(source, dest), null, JSON.stringify(dest));
  assert.equal(await destinationPage(source, 'missing'), null);
});

test('the whole tree is resolved once, keeping titles and the way to navigate', async () => {
  const raw = [
    {
      title: 'Parte',
      dest: [refs.r0],
      items: [
        { title: 'Capítulo', dest: 'late', items: [{ title: 'Seção', dest: [refs.r9] }] },
        { title: 'Site', dest: null, url: 'https://example.com', items: [] },
      ],
    },
    { dest: [refs.r4] },
  ];
  const tree = await resolveOutline(source, raw);
  assert.deepEqual(
    tree.map((e) => [e.title, e.page]),
    [
      ['Parte', 1],
      ['', 5],
    ],
  );
  assert.deepEqual(
    tree[0].items.map((e) => [e.title, e.page, e.items.length]),
    [
      ['Capítulo', 9, 1],
      ['Site', null, 0],
    ],
  );
  assert.equal(tree[0].items[0].dest, 'late', 'The destination is kept for PDF.js');
  assert.equal(tree[0].items[0].items[0].page, 10);
  for (const empty of [null, undefined, 'x', {}, []])
    assert.deepEqual(await resolveOutline(source, empty), []);
});

const tree = (spec) =>
  spec.map(([title, page, items = []]) => ({ title, page, dest: null, items: tree(items) }));
// Parte I (1) > Capítulo 1 (2) > Seção 1.1 (3), Seção 1.2 (5); Capítulo 2 (8)
// Parte II (10) > Capítulo 3 (10); Apêndice (null: a link outside the document)
const rows = flattenOutline(
  tree([
    [
      'Parte I',
      1,
      [
        [
          'Capítulo 1',
          2,
          [
            ['Seção 1.1', 3],
            ['Seção 1.2', 5],
          ],
        ],
        ['Capítulo 2', 8],
      ],
    ],
    ['Parte II', 10, [['Capítulo 3', 10]]],
    ['Apêndice', null],
  ]),
);
const title = (id) => rows.find((r) => r.id === id)?.entry.title ?? null;

test('the tree is flattened in reading order, with its path, depth and branches', () => {
  assert.deepEqual(
    rows.map((r) => [r.id, r.depth]),
    [
      ['0', 0],
      ['0.0', 1],
      ['0.0.0', 2],
      ['0.0.1', 2],
      ['0.1', 1],
      ['1', 0],
      ['1.0', 1],
      ['2', 0],
    ],
  );
  assert.deepEqual(rows.find((r) => r.id === '0').children, ['0.0', '0.1']);
  assert.deepEqual(rows.find((r) => r.id === '0.0.1').ancestors, ['0', '0.0']);
  assert.deepEqual(flattenOutline([]), []);
});

test('the current section is the deepest one that has started', () => {
  const at = (page) => title(currentSection(rows, page));
  assert.equal(at(1), 'Parte I', 'The page where a section starts is in it');
  assert.equal(at(2), 'Capítulo 1', 'A chapter on the page after its part is deeper');
  assert.equal(at(4), 'Seção 1.1');
  assert.equal(at(5), 'Seção 1.2');
  assert.equal(at(7), 'Seção 1.2', 'Pages after a section stay in it');
  assert.equal(at(8), 'Capítulo 2', 'The next chapter ends the subsections of the last one');
  assert.equal(at(9), 'Capítulo 2');
  assert.equal(at(10), 'Capítulo 3', 'A chapter that starts with its part is the deeper one');
  assert.equal(
    at(500),
    'Capítulo 3',
    'Past the end, the last one; an item without page never counts',
  );
  assert.equal(currentSection(rows, 0), null, 'Before the first section there is none');
  assert.equal(currentSection([], 3), null);
  const late = flattenOutline(tree([['Primeiro', 4]]));
  assert.equal(currentSection(late, 3), null, 'A cover before the first section');
});

test('an outline out of order still gives the nearest start, and the last of a tie', () => {
  const messy = flattenOutline(
    tree([
      ['B', 6],
      ['A', 2],
      ['C', 6],
      ['D', 9],
    ]),
  );
  const name = (page) => messy.find((r) => r.id === currentSection(messy, page))?.entry.title;
  assert.equal(name(3), 'A');
  assert.equal(name(6), 'C', 'Two sections on a page: the later one');
  assert.equal(name(8), 'C');
  assert.equal(name(9), 'D');
});

test('by default only the first level and the branches that hold the section are open', () => {
  const none = new Map();
  assert.deepEqual([...expandedBranches(rows, none, null)], [], 'Nothing selected: all closed');
  assert.deepEqual(
    visibleRows(rows, expandedBranches(rows, none, null)).map((r) => r.id),
    ['0', '1', '2'],
  );
  const open = expandedBranches(rows, none, '0.0.1');
  assert.deepEqual([...open].sort(), ['0', '0.0']);
  assert.deepEqual(
    visibleRows(rows, open).map((r) => title(r.id)),
    ['Parte I', 'Capítulo 1', 'Seção 1.1', 'Seção 1.2', 'Capítulo 2', 'Parte II', 'Apêndice'],
  );
  // Leaves have no branch to open, even if asked.
  const leaves = new Map([
    ['2', true],
    ['0.1', true],
  ]);
  assert.deepEqual([...expandedBranches(rows, leaves, null)], []);
});

test('the user can open and close a branch, including the ones that hold the section', () => {
  let folds = new Map();
  folds = toggleBranch(rows, folds, '1', null);
  assert.deepEqual([...expandedBranches(rows, folds, null)], ['1'], 'Opened by hand');
  folds = toggleBranch(rows, folds, '1', null);
  assert.deepEqual([...expandedBranches(rows, folds, null)], [], 'Closed again');
  const closed = toggleBranch(rows, new Map(), '0', '0.0.1');
  assert.equal(expandedBranches(rows, closed, '0.0.1').has('0'), false, 'A holding branch closes');
  assert.equal(expandedBranches(rows, closed, '0.0.1').has('0.0'), true);
  // Moving to another section shows it again; the other choices stay.
  const manual = toggleBranch(rows, closed, '1', '0.0.1');
  const moved = revealSection(rows, manual, '0.1');
  assert.equal(expandedBranches(rows, moved, '0.1').has('0'), true);
  assert.equal(expandedBranches(rows, moved, '0.1').has('1'), true);
  assert.equal(revealSection(rows, manual, null).get('1'), true);
  assert.equal(manual.has('0'), true, 'The folds are not changed in place');
  assert.equal(manual.get('0'), false);
});
