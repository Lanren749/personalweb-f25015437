import { domesticCandidate, parseRecommendations, searchQueries } from '../dist/shared/model/Ai.js';

// Small, auditable business tools used by the competition research agent.
export function buildSearchQueries(profile, now) {
  return searchQueries(profile, now);
}

export function filterDomesticSources(hits) {
  const unique = [];
  for (const hit of hits) {
    if (domesticCandidate(hit) && !unique.some(existing => existing.url === hit.url)) unique.push(hit);
  }
  return unique;
}

export function verifyEvidence(modelJson, sources) {
  return parseRecommendations(modelJson, sources);
}
