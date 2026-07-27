import {
  cosineSimilarity,
  embedLocalSemanticText,
  lexicalFeatureSimilarity,
  normalizeSemanticText,
  semanticFeatureCoverage,
  semanticLexicalWeights
} from "./unified-memory/semantic-embedding.js";

const qqContextEmbeddingDimensions = 256;
const qqContextEmbeddingCacheLimit = 4096;
const qqContextEmbeddingCache = new Map();

export function createQqContextSemanticScorer(query) {
  const normalizedQuery = normalizeSemanticText(query);
  const queryEmbedding = normalizedQuery
    ? embedLocalSemanticText(normalizedQuery, {
        dimensions: qqContextEmbeddingDimensions
      })
    : null;
  const queryFeatures = normalizedQuery
    ? semanticLexicalWeights(normalizedQuery)
    : null;
  return (candidate) => scoreQqContextSemanticRelevance(normalizedQuery, candidate, {
    queryEmbedding,
    queryFeatures
  });
}

export function scoreQqContextSemanticRelevance(query, candidate, {
  queryEmbedding = null,
  queryFeatures = null
} = {}) {
  const normalizedQuery = normalizeSemanticText(query);
  const normalizedCandidate = normalizeSemanticText(candidate);
  if (!normalizedQuery || !normalizedCandidate) {
    return {
      score: 0,
      vectorScore: 0,
      lexicalScore: 0,
      coverageScore: 0
    };
  }
  const resolvedQueryEmbedding = queryEmbedding || embedLocalSemanticText(normalizedQuery, {
    dimensions: qqContextEmbeddingDimensions
  });
  const resolvedQueryFeatures = queryFeatures || semanticLexicalWeights(normalizedQuery);
  const candidateProfile = getCachedContextProfile(normalizedCandidate);
  const vectorScore = Math.max(0, cosineSimilarity(
    resolvedQueryEmbedding,
    candidateProfile.embedding
  ));
  const lexicalScore = Math.max(0, lexicalFeatureSimilarity(
    resolvedQueryFeatures,
    candidateProfile.features
  ));
  const coverageScore = Math.max(0, semanticFeatureCoverage(
    resolvedQueryFeatures,
    candidateProfile.features
  ));
  return {
    score: clampScore(
      vectorScore * 0.62
      + lexicalScore * 0.23
      + coverageScore * 0.15
    ),
    vectorScore,
    lexicalScore,
    coverageScore
  };
}

function getCachedContextProfile(normalizedText) {
  const cached = qqContextEmbeddingCache.get(normalizedText);
  if (cached) {
    qqContextEmbeddingCache.delete(normalizedText);
    qqContextEmbeddingCache.set(normalizedText, cached);
    return cached;
  }
  const profile = {
    embedding: embedLocalSemanticText(normalizedText, {
      dimensions: qqContextEmbeddingDimensions
    }),
    features: semanticLexicalWeights(normalizedText)
  };
  qqContextEmbeddingCache.set(normalizedText, profile);
  while (qqContextEmbeddingCache.size > qqContextEmbeddingCacheLimit) {
    const oldestKey = qqContextEmbeddingCache.keys().next().value;
    qqContextEmbeddingCache.delete(oldestKey);
  }
  return profile;
}

function clampScore(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
