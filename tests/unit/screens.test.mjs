import test from 'node:test';
import assert from 'node:assert/strict';
import { turnScreen } from '../../src/reading/screens.ts';

test('screen turns cover the whole document at different zooms, sizes and Windows scales', () => {
  for (const height of [360, 723, 1000])
    for (const scale of [0.5, 1.54, 3, 5])
      for (const pixelRatio of [1, 1.25, 1.5, 2]) {
        let state = { top: 0, edgeReturn: null };
        const input = { max: 10237, height, scale, pixelRatio, direction: 1 };
        for (let i = 0; state.top < input.max && i < 100; i++) {
          const next = turnScreen({ ...input, ...state });
          assert.ok(next.top > state.top && next.top - state.top < height);
          const back = turnScreen({ ...input, ...next, direction: -1 });
          assert.ok(Math.abs(back.top - state.top) < 0.001);
          state = next;
        }
        assert.equal(state.top, input.max);
        const repeated = turnScreen({ ...input, ...state });
        assert.deepEqual(repeated, state);
      }
});
test('one-screen documents and beginning boundary remain stable', () => {
  const input = { top: 0, max: 0, height: 600, scale: 1, pixelRatio: 1.5, edgeReturn: null };
  assert.equal(turnScreen({ ...input, direction: 1 }).top, 0);
  assert.equal(turnScreen({ ...input, direction: -1 }).top, 0);
});
