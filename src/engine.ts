
import type {
  AppState,
  HistoricalResult,
  Pair,
  Score
} from './types';

import data from './data.json';

// Tournament records.

export const roster: string[] =
  data.players;

export const results: HistoricalResult[] =
  data.results as HistoricalResult[];

export const course = data.course;

export const committee =
  data.committee as Record<string, string>;

export const founders =
  data.founders;

export const venues =
  data.venues as unknown as
    Record<string, [string, string]>;

// Default application data.

export const initial: AppState = {
  players: roster.map(name => ({
    name,
    handicap: null,
  })),

  pairs: [],

  scores: [],

  eventStatus: 'registration',

  published: false,
};

// Historical result helpers.

export const ordinal = (
  position: string | null
) => position || 'DNF';

export const positionNum = (
  position: string | null
) =>
  position
    ? Number(
        position.replace(/[^0-9]/g, '')
      )
    : 999;

export function playerHistory(
  name: string
) {
  return results
    .filter(result =>
      result.players.includes(name)
    )
    .sort(
      (a, b) => a.year - b.year
    );
}

export function stats(
  name: string
) {
  const history = playerHistory(name);

  const finishes = history.filter(
    result =>
      result.status === 'finished'
  );

  return {
    starts: new Set(
      history.map(result => result.year)
    ).size,

    titles: history.filter(
      result =>
        result.position === '1st'
    ).length,

    debut: history.length
      ? Math.min(
          ...history.map(
            result => result.year
          )
        )
      : null,

    best: finishes.length
      ? finishes.reduce(
          (a, b) =>
            positionNum(a.position) <
            positionNum(b.position)
              ? a
              : b
        ).position
      : null,

    podiums: finishes.filter(
      result =>
        positionNum(result.position) <= 3
    ).length,

    avg: finishes.length
      ? finishes.reduce(
          (sum, result) =>
            sum + positionNum(
              result.position
            ),
          0
        ) / finishes.length
      : null,
  };
}

// Calculate the two-person Ambrose handicap.
// 35% lower + 15% higher.

export function teamHandicap(
  a: number | null,
  b: number | null
) {
  if (a === null || b === null) {
    return null;
  }

  return Math.round(
    (
      Math.min(a, b) * 0.35 +
      Math.max(a, b) * 0.15
    ) * 100
  ) / 100;
}

// Six groups for 13 pairs.
//
// Groups 1-5: two pairs each.
// Group 6: three pairs.

const capacity = [
  2, 2, 2, 2, 2, 3
];

// Draft starting holes.
// These require confirmation
// from Clare Golf Club.

const draftHoles = [
  1, 4, 7, 10, 13, 16
];

// Generate random pairs.
// Existing locked pairs stay together.

export function randomPairs(
  state: AppState
): Pair[] {

  if (
    state.players.length !== 26
  ) {
    throw Error(
      'The draw requires 26 players.'
    );
  }

  const locked = state.pairs.filter(
    pair => pair.locked
  );

  const lockedNames = locked.flatMap(
    pair => pair.players
  );

  if (
    new Set(lockedNames).size !==
    lockedNames.length
  ) {
    throw Error(
      'A player appears in more than one locked pair.'
    );
  }

  const groupCounts = [
    0, 0, 0, 0, 0, 0
  ];

  for (const pair of locked) {
    if (
      pair.group < 1 ||
      pair.group > 6
    ) {
      throw Error(
        'Locked pairs must be assigned to Groups 1 to 6.'
      );
    }

    groupCounts[pair.group - 1]++;

    if (
      groupCounts[pair.group - 1] >
      capacity[pair.group - 1]
    ) {
      throw Error(
        'Too many locked pairs in one group.'
      );
    }
  }

  const slots: number[] = [];

  for (
    let group = 0;
    group < 6;
    group++
  ) {
    for (
      let i = groupCounts[group];
      i < capacity[group];
      i++
    ) {
      slots.push(group + 1);
    }
  }

  const remaining = state.players
    .map(player => player.name)
    .filter(
      name =>
        !lockedNames.includes(name)
    );

  // Fisher-Yates shuffle.

  for (
    let i = remaining.length - 1;
    i > 0;
    i--
  ) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [
      remaining[i],
      remaining[j]
    ] = [
      remaining[j],
      remaining[i]
    ];
  }

  if (
    remaining.length !==
    slots.length * 2
  ) {
    throw Error(
      'Locked pair count does not match the field.'
    );
  }

  const made: Pair[] = [];

  for (
    let i = 0;
    i < remaining.length;
    i += 2
  ) {
    const a = remaining[i];

    const b = remaining[i + 1];

    const group = slots[i / 2];

    const firstLocked = locked.find(
      pair =>
        pair.group === group
    );

    made.push({
      id: `pair-${crypto.randomUUID()}`,

      players: [a, b],

      group,

      startHole:
        firstLocked?.startHole ??
        draftHoles[group - 1],

      locked: false,

      published: false,

      hcp: teamHandicap(
        state.players.find(
          player =>
            player.name === a
        )?.handicap ?? null,

        state.players.find(
          player =>
            player.name === b
        )?.handicap ?? null
      ),
    });
  }

  return [
    ...locked,
    ...made
  ];
}

// Validate the complete pairing draw.

export function validateDraw(
  pairs: Pair[],
  playerNames: string[]
): string | null {

  if (
    pairs.length !== 13
  ) {
    return 'There must be 13 pairs.';
  }

  const names = pairs.flatMap(
    pair => pair.players
  );

  if (
    new Set(names).size !== 26 ||
    names.some(
      name =>
        !playerNames.includes(name)
    )
  ) {
    return (
      'All 26 players must ' +
      'appear exactly once.'
    );
  }

  const groupHoles =
    new Map<number, number>();

  for (
    let group = 1;
    group <= 6;
    group++
  ) {
    const entries = pairs.filter(
      pair =>
        pair.group === group
    );

    if (
      entries.length !==
      capacity[group - 1]
    ) {
      return (
        `Group ${group} needs ` +
        `${capacity[group - 1]} pairs.`
      );
    }

    const holes = new Set(
      entries.map(
        pair => pair.startHole
      )
    );

    if (
      holes.size !== 1
    ) {
      return (
        `Every pair in Group ${group} ` +
        'must start on the same hole.'
      );
    }

    groupHoles.set(
      group,
      entries[0].startHole
    );
  }

  if (
    new Set(
      [...groupHoles.values()]
    ).size !== 6
  ) {
    return (
      'Give all six groups ' +
      'different starting holes.'
    );
  }

  return null;
}

// Hole order for shotgun starts.

export function shotgunOrder(
  start: number
) {
  return Array.from(
    {
      length: 18
    },
    (_, i) =>
      (start + i - 1) % 18 + 1
  );
}

// Get every score recorded by one pair.

export function pairScores(
  pairId: string,
  scores: Score[]
) {
  return scores.filter(
    score =>
      score.pairId === pairId
  );
}

// Count selected drives.

export function driveCounts(
  pair: Pair,
  scores: Score[]
) {
  const recorded = pairScores(
    pair.id,
    scores
  );

  return pair.players.map(
    player =>
      recorded.filter(
        score =>
          score.drive === player
      ).length
  );
}

// Apply the minimum six-drive rule.
// Two penalty strokes for each missing drive.

export function penalties(
  pair: Pair,
  scores: Score[]
) {
  const recorded = pairScores(
    pair.id,
    scores
  );

  if (
    recorded.length < 18
  ) {
    return 0;
  }

  return driveCounts(
    pair,
    scores
  ).reduce(
    (total, count) =>
      total +
      Math.max(
        0,
        6 - count
      ) * 2,
    0
  );
}

// Calculate leaderboard standings.

export function standings(
  state: AppState
) {
  return state.pairs
    .map(pair => {
      const recorded = pairScores(
        pair.id,
        state.scores
      );

      const gross = recorded.reduce(
        (total, score) =>
          total +
          score.strokes +
          score.penalty,
        0
      );

      const par = recorded.reduce(
        (total, score) =>
          total +
          (
            course.find(
              hole =>
                hole.hole === score.hole
            )?.par || 0
          ),
        0
      );

      const done =
        recorded.length === 18;

      const pen = penalties(
        pair,
        state.scores
      );

      return {
        pair,

        holes: recorded.length,

        gross: gross + pen,

        pen,

        relative:
          gross + pen - par,

        net:
          done &&
          pair.hcp !== null
            ? gross +
              pen -
              pair.hcp
            : null,

        done,
      };
    })
    .sort(
      (a, b) => {
        if (
          a.done &&
          b.done &&
          a.net !== null &&
          b.net !== null
        ) {
          return a.net - b.net;
        }

        if (
          a.done !== b.done
        ) {
          return a.done ? -1 : 1;
        }

        return (
          a.relative -
          b.relative
        );
      }
    );
}

// Identify previous playing partnerships.

export function sharedPastPartners(
  a: string,
  b: string
) {
  return results
    .filter(
      result =>
        result.players.includes(a) &&
        result.players.includes(b)
    )
    .map(
      result => result.year
    );
}
