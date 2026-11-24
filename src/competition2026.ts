
import type {
  AppState,
  Pair,
  Score,
  SelectedShot
} from './types';

import {
  results,
  teamHandicap
} from './engine';

import {
  course2026,
  MIN_DRIVES
} from './course2026';

export type AvoidVote = {
  player_name: string;
  avoid_one: string;
  avoid_two: string;
};

export type Confirmation = {
  pair_id: string;
  player_name: string;
  confirmed_at: string;
};

function shuffle<T>(items: T[]): T[] {
  const out = [...items];

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

export function makeDraw(
  state: AppState,
  votes: AvoidVote[]
): Pair[] {

  const names = state.players.map(p => p.name);

  if (
    names.length !== 26 ||
    new Set(names).size !== 26
  ) {
    throw Error('Expected 26 unique players.');
  }

  if (
    votes.length !== 26 ||
    new Set(
      votes.map(v => v.player_name)
    ).size !== 26
  ) {
    throw Error(
      'Every player must submit two preferences first.'
    );
  }

  const incompatible = new Set<string>();

  const pairKey = (
    a: string,
    b: string
  ) => [a, b].sort().join('|');

  // Both players' exclusions apply.

  for (const vote of votes) {

    if (
      !names.includes(vote.player_name) ||
      !names.includes(vote.avoid_one) ||
      !names.includes(vote.avoid_two) ||
      vote.avoid_one === vote.avoid_two ||
      [
        vote.avoid_one,
        vote.avoid_two
      ].includes(vote.player_name)
    ) {
      throw Error(
        'Invalid preferences for ' +
        vote.player_name
      );
    }

    incompatible.add(
      pairKey(
        vote.player_name,
        vote.avoid_one
      )
    );

    incompatible.add(
      pairKey(
        vote.player_name,
        vote.avoid_two
      )
    );
  }

  // Previous partnerships receive a penalty
  // when deciding between otherwise valid draws.

  const previous = new Map<string, number>();

  for (const result of results) {
    for (
      let i = 0;
      i < result.players.length;
      i++
    ) {
      for (
        let j = i + 1;
        j < result.players.length;
        j++
      ) {

        const key = pairKey(
          result.players[i],
          result.players[j]
        );

        previous.set(
          key,
          (previous.get(key) || 0) + 1
        );
      }
    }
  }

  // Backtracking finds a valid complete matching.
  // The most restricted player is paired first.
  // Exclusions are never silently ignored.

  const search = (
    remaining: string[]
  ): [string, string][] | null => {

    if (!remaining.length) return [];

    const byOptions = remaining.map(a => ({
      a,
      options: remaining.filter(
        b =>
          b !== a &&
          !incompatible.has(pairKey(a, b))
      )
    })).sort(
      (a, b) =>
        a.options.length - b.options.length
    );

    const {
      a,
      options
    } = byOptions[0];

    if (!options.length) return null;

    const sorted = shuffle(options).sort(
      (b, c) =>
        (previous.get(pairKey(a, b)) || 0) -
        (previous.get(pairKey(a, c)) || 0)
    );

    for (const b of sorted) {

      const next = remaining.filter(
        x => x !== a && x !== b
      );

      const rest = search(next);

      if (rest) {
        return [[a, b], ...rest];
      }
    }

    return null;
  };

  let best: [string, string][] | null = null;
  let bestWeight = Infinity;

  // Try alternative valid draws and prefer
  // fewer repeated historical partnerships.

  for (let attempt = 0; attempt < 40; attempt++) {

    const candidate = search(
      shuffle(names)
    );

    if (!candidate) break;

    const weight = candidate.reduce(
      (sum, [a, b]) =>
        sum + (
          previous.get(pairKey(a, b)) || 0
        ),
      0
    );

    if (weight < bestWeight) {
      best = candidate;
      bestWeight = weight;

      if (weight === 0) break;
    }
  }

  if (!best) {
    throw Error(
      'No draw satisfies all 52 exclusions. ' +
      'Ask players to revise their preferences.'
    );
  }

  // Six shotgun groups.
  // Five groups of two pairs.
  // One group of three pairs.

  const startingHoles = [
    1, 4, 7, 10, 13, 16
  ];

  return best.map(([a, b], index) => {

    const group = Math.min(
      Math.floor(index / 2) + 1,
      6
    );

    const handicapA =
      state.players.find(
        p => p.name === a
      )?.handicap ?? null;

    const handicapB =
      state.players.find(
        p => p.name === b
      )?.handicap ?? null;

    return {
      id: 'pair-' + crypto.randomUUID(),
      players: [a, b],
      group,
      startHole: startingHoles[group - 1],
      locked: false,
      published: false,
      hcp: teamHandicap(
        handicapA,
        handicapB
      )
    };
  });
}

// Convert old single-drive records into a
// readable fallback. New records hold every shot.

export function shotsFor(
  score: Score
): SelectedShot[] {

  if (score.shots?.length) {
    return score.shots;
  }

  if (!score.drive) return [];

  return [
    {
      player: score.drive,
      kind: 'tee'
    },

    ...Array.from(
      {
        length: Math.max(
          0,
          score.strokes - 1
        )
      },
      () => ({
        player: 'Unknown',
        kind: 'approach' as const
      })
    )
  ];
}

// Selected shot statistics for each pair.

export function pairMetrics(
  pair: Pair,
  scores: Score[]
) {

  const allCards = scores.filter(
    s => s.pairId === pair.id
  );

  const cards = allCards.filter(
    s => s.completed
  );

  const owners = pair.players;

  const selectedShots = allCards
    .flatMap(shotsFor)
    .filter(
      shot =>
        owners.includes(shot.player)
    );

  const teeShots = cards
    .map(s => shotsFor(s)[0]?.player)
    .filter(
      (p): p is string => !!p
    );

  const selected = owners.map(
    player =>
      selectedShots.filter(
        shot =>
          shot.player === player
      ).length
  );

  const drives = owners.map(
    player =>
      teeShots.filter(
        name => name === player
      ).length
  );

  const finished =
    cards.length === 18 &&
    new Set(
      cards.map(s => s.hole)
    ).size === 18;

  const strokes = cards.reduce(
    (total, s) =>
      total + s.strokes + s.penalty,
    0
  );

  const parPlayed = cards.reduce(
    (total, s) =>
      total + (
        course2026[s.hole - 1]?.par || 0
      ),
    0
  );

  const validDrives = drives.every(
    n => n >= MIN_DRIVES
  );

  const total = selected.reduce(
    (a, b) => a + b,
    0
  );

  const percent = selected.map(
    count =>
      total
        ? Math.round(
            count / total * 1000
          ) / 10
        : 0
  );

  const putts = cards.reduce(
    (total, s) =>
      total +
      shotsFor(s).filter(
        shot =>
          shot.kind === 'putt'
      ).length,
    0
  );

  const fairwayChances = cards.filter(
    s =>
      course2026[s.hole - 1]?.par !== 3
  ).length;

  const fairways = cards.filter(
    s =>
      course2026[s.hole - 1]?.par !== 3 &&
      shotsFor(s)[0]?.lie === 'fairway'
  ).length;

  const greens = cards.filter(
    s => {
      const par =
        course2026[s.hole - 1]?.par ?? 0;

      return shotsFor(s).some(
        (shot, i) =>
          i <= par - 2 &&
          shot.lie === 'green'
      );
    }
  ).length;

  const net =
    finished &&
    validDrives &&
    pair.hcp !== null
      ? Math.round(
          (strokes - pair.hcp) * 100
        ) / 100
      : null;

  return {
    holes: cards.length,
    strokes,
    relative: strokes - parPlayed,
    selected,
    drives,
    percent,
    putts,
    fairways,
    fairwayChances,
    greens,
    finished,
    validDrives,
    net
  };
}

export function orderedLeaderboard(
  state: AppState
) {

  return state.pairs
    .map(pair => ({
      pair,
      ...pairMetrics(
        pair,
        state.scores
      )
    }))
    .sort((a, b) => {

      if (a.finished !== b.finished) {
        return a.finished ? -1 : 1;
      }

      if (a.finished && b.finished) {
        if (a.net === null) return 1;
        if (b.net === null) return -1;

        return a.net - b.net;
      }

      if (a.holes !== b.holes) {
        return b.holes - a.holes;
      }

      return a.relative - b.relative;
    });
}

// Check Director edits before publication.

export function validationProblems(
  pairs: Pair[],
  players: string[]
): string | null {

  if (pairs.length !== 13) {
    return 'Draw needs exactly 13 pairs';
  }

  const names = pairs.flatMap(
    pair => pair.players
  );

  if (
    names.length !== 26 ||
    new Set(names).size !== 26 ||
    names.some(
      name => !players.includes(name)
    )
  ) {
    return '26 unique roster players required';
  }

  const groupSlots = [
    2, 2, 2, 2, 2, 3
  ];

  const startingHoles = new Set<number>();

  for (let group = 1; group <= 6; group++) {

    const entries = pairs.filter(
      pair =>
        pair.group === group
    );

    if (
      entries.length !==
      groupSlots[group - 1]
    ) {
      return (
        `Group ${group} must have ` +
        `${groupSlots[group - 1]} pairs`
      );
    }

    if (
      new Set(
        entries.map(
          pair => pair.startHole
        )
      ).size !== 1
    ) {
      return (
        `Group ${group} must share ` +
        'a starting hole'
      );
    }

    if (
      entries[0].startHole < 1 ||
      entries[0].startHole > 18
    ) {
      return 'Starting holes must be 1-18';
    }

    startingHoles.add(
      entries[0].startHole
    );
  }

  if (startingHoles.size !== 6) {
    return (
      'All six groups must have ' +
      'distinct starting holes'
    );
  }

  if (
    pairs.some(pair => pair.hcp === null)
  ) {
    return (
      'Every player needs an approved handicap'
    );
  }

  return null;
}
