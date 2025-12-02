import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustCompetitionCounts } from '../src/competition.js';

test('subtracts one competitor but not below zero', () => {
  const { compCount, heavyCount } = adjustCompetitionCounts(2, 1);
  assert.equal(compCount, 1);
  assert.equal(heavyCount, 1);
});

test('never returns negative counts', () => {
  const { compCount, heavyCount } = adjustCompetitionCounts(0, 0);
  assert.equal(compCount, 0);
  assert.equal(heavyCount, 0);
});

test('heavy count cannot exceed adjusted total', () => {
  const { compCount, heavyCount } = adjustCompetitionCounts(1, 3);
  assert.equal(compCount, 0);
  assert.equal(heavyCount, 0);
});
