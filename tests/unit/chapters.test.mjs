import test from 'node:test';
import assert from 'node:assert/strict';
import { isChapterHeading, startsChapter } from '../../src/reading/chapters.ts';
import { turnScreen } from '../../src/reading/screens.ts';

test('recognizes explicit chapter headings without treating narrative references as titles', () => {
  for (const heading of [
    'CAPÍTULO DOIS',
    '- Capítulo 17 -',
    'Chapter XXIII',
    'Parte três',
    'Prólogo',
  ])
    assert.equal(isChapterHeading(heading), true, heading);
  for (const text of [
    'No capítulo dois ele voltou.',
    'Capítulo anterior explica o assunto.',
    'Uma manhã comum',
    'capítulo seguinte',
  ])
    assert.equal(isChapterHeading(text), false, text);
  assert.equal(
    startsChapter([
      { str: '-', transform: [1, 0, 0, 1, 10, 700] },
      { str: 'CAPÍTULO', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'UM', transform: [1, 0, 0, 1, 100, 700] },
    ]),
    true,
  );
});

test('chapter screens cover every preceding paragraph, align titles and turn back without gaps', () => {
  for (const height of [360, 723, 1000])
    for (const scale of [0.5, 1.54, 3])
      for (const pixelRatio of [1, 1.25, 1.5, 2]) {
        const breaks = [37, 1237, 1968, 3201, 3260, 5000];
        const input = { max: 5000, height, scale, pixelRatio, breaks, direction: 1 };
        let state = { top: 0, edgeReturn: null };
        let covered = 0;
        const visited = new Set();
        for (let n = 0; n < 100; n++) {
          const sectionEnd = breaks.find((point) => point > state.top + 1) ?? Infinity;
          assert.ok(state.top <= covered + 0.001, 'No preceding content may be skipped');
          covered = Math.max(covered, Math.min(state.top + height, sectionEnd));
          const next = turnScreen({ ...input, ...state });
          if (next.top === state.top) break;
          const back = turnScreen({ ...input, ...next, direction: -1 });
          assert.ok(Math.abs(back.top - state.top) < 0.001);
          visited.add(next.top);
          state = next;
        }
        for (const point of breaks) assert.ok(visited.has(point), `Title missed at ${point}`);
        assert.equal(state.top, input.max);
        // Reopening on a title has no previous-turn history and still goes back.
        assert.ok(turnScreen({ ...input, top: 1968, edgeReturn: null, direction: -1 }).top < 1968);
      }
});
