import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJevQuestions,
  matchedLabelIds,
} from "../src/worker/email/label.ts";

const labels = [
  { id: 1, name: "guest-post", condition: "A guest post pitch" },
  { id: 2, name: "sponsor", condition: "A sponsorship offer" },
];

test("buildJevQuestions creates one noul question per label", () => {
  const questions = buildJevQuestions(labels);
  assert.deepEqual(Object.keys(questions).sort(), ["label_1", "label_2"]);
  const question = questions.label_1;
  assert.equal(question.type, "noul");
  assert.match(question.instructions, /guest-post/);
  assert.equal(question.criteria.true, "A guest post pitch");
  assert.match(question.criteria.false, /does not match/);
});

test("matchedLabelIds keeps labels at or above the match threshold", () => {
  const response = {
    answers: {
      label_1: { type: "noul", noul: 0.9 },
      label_2: { type: "noul", noul: 0.2 },
    },
  };
  assert.deepEqual(matchedLabelIds(labels, response), [1]);

  assert.deepEqual(
    matchedLabelIds(labels, {
      answers: { label_1: { noul: 0.5 }, label_2: { noul: 0.97 } },
    }),
    [1, 2],
  );
});

test("missing or malformed answers match nothing", () => {
  assert.deepEqual(matchedLabelIds(labels, { answers: {} }), []);
  assert.deepEqual(matchedLabelIds(labels, {}), []);
  assert.deepEqual(matchedLabelIds(labels, null), []);
  assert.deepEqual(
    matchedLabelIds(labels, { answers: { label_1: { noul: "yes" } } }),
    [],
  );
});
