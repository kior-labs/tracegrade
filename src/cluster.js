/**
 * Deterministic text clustering: tf-idf vectors, cosine similarity, greedy
 * centroid clustering. No dependencies, no model calls, same input gives the
 * same clusters on every machine.
 */

const STOPWORDS = new Set(
  `a an and are as at be been being but by can could did do does for from had has have how i if in into is it its just like me my no not of on or our out over so than that the their them then there these they this to too was we were what when where which who why will with you your`.split(
    ' ',
  ),
);

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

export function buildVectors(texts) {
  const docs = texts.map(tokenize);
  const df = new Map();
  for (const tokens of docs) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) || 0) + 1);
  }
  const total = docs.length || 1;
  const idf = new Map([...df].map(([token, count]) => [token, Math.log((total + 1) / (count + 1)) + 1]));

  const vectors = docs.map((tokens) => {
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    const vector = new Map();
    let norm = 0;
    for (const [token, count] of counts) {
      const weight = (1 + Math.log(count)) * idf.get(token);
      vector.set(token, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [token, weight] of vector) vector.set(token, weight / norm);
    return vector;
  });

  return { vectors, idf, docs };
}

export function cosine(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [token, weight] of small) {
    const other = large.get(token);
    if (other) dot += weight * other;
  }
  return dot;
}

export function clusterItems(items, { threshold = 0.08 } = {}) {
  const { vectors } = buildVectors(items.map((item) => item.text));
  const clusters = [];

  items.forEach((item, index) => {
    const vector = vectors[index];
    let best = null;
    let bestScore = -1;
    for (const cluster of clusters) {
      const score = cosine(vector, cluster.centroid);
      if (score > bestScore) {
        bestScore = score;
        best = cluster;
      }
    }
    if (best && bestScore >= threshold) {
      best.members.push(index);
      const size = best.members.length;
      for (const [token, weight] of vector) {
        const current = best.centroid.get(token) || 0;
        best.centroid.set(token, (current * (size - 1) + weight) / size);
      }
    } else {
      clusters.push({ members: [index], centroid: new Map(vector) });
    }
  });

  return clusters.map((cluster, index) => ({ ...cluster, id: index + 1 }));
}

export function topTerms(centroid, count = 4) {
  return [...centroid.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([token]) => token);
}
