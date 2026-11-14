import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterItems, cosine, tokenize } from '../src/cluster.js';

test('tokenizer drops stopwords and short tokens', () => {
  assert.deepEqual(tokenize('The order was not found for that customer'), ['order', 'found', 'customer']);
});

test('cosine is 1 for identical vectors and 0 for disjoint ones', () => {
  const a = new Map([['order', 1]]);
  const b = new Map([['order', 1]]);
  const c = new Map([['refund', 1]]);
  assert.equal(cosine(a, b), 1);
  assert.equal(cosine(a, c), 0);
});

test('groups similar failures and separates different ones', () => {
  const items = [
    { id: '1', text: 'order lookup timeout upstream 504 service unavailable' },
    { id: '2', text: 'order lookup timeout upstream 504 connection reset' },
    { id: '3', text: 'refund amount wrong customer charged twice payment' },
    { id: '4', text: 'refund amount wrong payment charged twice customer' },
    { id: '5', text: 'refused to answer cancellation policy request' },
  ];
  const clusters = clusterItems(items, { threshold: 0.25 });
  const orderCluster = clusters.find((cluster) => cluster.members.includes(0));
  assert.ok(orderCluster.members.includes(1));
  assert.ok(!orderCluster.members.includes(2));
  assert.ok(clusters.length >= 2);
});

test('is deterministic', () => {
  const items = [
    { id: '1', text: 'order lookup timeout upstream' },
    { id: '2', text: 'refund amount wrong payment' },
    { id: '3', text: 'order lookup timeout service' },
  ];
  const first = clusterItems(items, { threshold: 0.2 }).map((cluster) => cluster.members.join(','));
  const second = clusterItems(items, { threshold: 0.2 }).map((cluster) => cluster.members.join(','));
  assert.deepEqual(first, second);
});
