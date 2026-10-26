import type { RecogniseResult, UnifiedTrack } from '@/lib/api';

export interface RankedCandidate {
  track: UnifiedTrack;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

const BAD_VERSION_WORDS = [
  'remix',
  'slowed',
  'sped up',
  'speed up',
  'cover',
  'instrumental',
  'live',
  'acoustic',
  'karaoke',
  'nightcore',
  '8d',
  'mashup',
  'tribute',
];

function norm(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^\\w\\s]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function hasWord(haystack: string, needle: string): boolean {
  return haystack.includes(needle);
}

function durationDeltaSeconds(candidate: UnifiedTrack, targetDurationMs?: number): number | null {
  if (!candidate.durationMs || !targetDurationMs) return null;
  return Math.abs(candidate.durationMs - targetDurationMs) / 1000;
}

export function scoreCandidate(candidate: UnifiedTrack, result: RecogniseResult): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const targetTitle = norm(result.title);
  const targetArtist = norm(result.artist);
  const candidateTitle = norm(candidate.title);
  const candidateArtist = norm(candidate.artist);

  if (candidateTitle === targetTitle) {
    score += 45;
    reasons.push('Exact title match');
  } else if (targetTitle && candidateTitle.includes(targetTitle)) {
    score += 20;
    reasons.push('Title contains the recognised title');
  }

  if (candidateArtist === targetArtist) {
    score += 35;
    reasons.push('Exact artist match');
  } else if (targetArtist && candidateArtist.includes(targetArtist)) {
    score += 15;
    reasons.push('Artist name overlaps');
  }

  if (result.album && candidate.album && norm(candidate.album) === norm(result.album)) {
    score += 15;
    reasons.push('Album matches');
  }

  if (result.soundcloud?.isrc && candidate.isrc && result.soundcloud.isrc === candidate.isrc) {
    score += 60;
    reasons.push('ISRC matches');
  }

  const targetDuration = result.soundcloud?.durationMs;
  const delta = durationDeltaSeconds(candidate, targetDuration);
  if (delta !== null) {
    if (delta <= 3) {
      score += 25;
      reasons.push('Duration matches closely');
    } else if (delta <= 10) {
      score += 12;
      reasons.push('Duration is close');
    } else if (delta <= 30) {
      score += 4;
    } else {
      score -= 15;
      reasons.push('Duration differs significantly');
    }
  }

  const introducedVersionWords = BAD_VERSION_WORDS.filter(
    (word) => hasWord(candidateTitle, word) && !hasWord(targetTitle, word),
  );
  if (introducedVersionWords.length > 0) {
    score -= 30 * introducedVersionWords.length;
    reasons.push(`Possible alternate version: ${introducedVersionWords.join(', ')}`);
  }

  if (candidate.downloadable) {
    score += 15;
    reasons.push('Download enabled by creator');
  } else {
    score -= 5;
  }

  if (candidate.source === 'soundcloud') {
    score += 5;
  }

  return { score, reasons };
}

export function rankDownloadCandidates(candidates: UnifiedTrack[], result: RecogniseResult): RankedCandidate[] {
  const scored = candidates.map((track) => {
    const { score, reasons } = scoreCandidate(track, result);
    let confidence: RankedCandidate['confidence'] = 'low';
    if (score >= 70) confidence = 'high';
    else if (score >= 40) confidence = 'medium';
    return { track, score, confidence, reasons };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aDl = a.track.downloadable ? 1 : 0;
    const bDl = b.track.downloadable ? 1 : 0;
    if (bDl !== aDl) return bDl - aDl;
    return a.track.title.localeCompare(b.track.title);
  });

  const bestTitle = scored[0]?.track.title ? norm(scored[0].track.title) : '';
  if (bestTitle && !BAD_VERSION_WORDS.some((w) => bestTitle.includes(w))) {
    for (const item of scored.slice(1)) {
      const t = norm(item.track.title);
      if (BAD_VERSION_WORDS.some((w) => t.includes(w))) {
        item.score -= 10;
      }
    }
    scored.sort((a, b) => b.score - a.score);
  }

  return scored;
}

export function bestDownloadCandidate(candidates: RankedCandidate[]): RankedCandidate | null {
  return candidates.find((item) => item.track.downloadable) ?? candidates[0] ?? null;
}

export function hasDownloadableCandidate(candidates: RankedCandidate[]): boolean {
  return candidates.some((item) => item.track.downloadable);
}
