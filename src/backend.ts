
import {
  createClient
} from '@supabase/supabase-js';

import type {
  AppState,
  Pair,
  Score
} from './types';

import type {
  AvoidVote,
  Confirmation
} from './competition2026';

import {
  initial
} from './engine';

// SUPABASE CONNECTION

const url =
  import.meta.env.VITE_SUPABASE_URL as string | undefined;

const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudEnabled = Boolean(url && key);

export const supabase = cloudEnabled
  ? createClient(url!, key!)
  : null;

// ERROR HANDLING

export const explain = (
  error: unknown
): string => {

  if (
    error &&
    typeof error === 'object'
  ) {
    const e = error as {
      message?: string;
      details?: string;
      hint?: string;
      code?: string;
    };

    return [
      e.message,
      e.details,
      e.hint,
      e.code
    ]
      .filter(Boolean)
      .join(' | ') || JSON.stringify(error);
  }

  return String(error);
};

// CHECK SUPABASE RESPONSES

function checked<T>(
  result: {
    data: T;
    error: unknown;
  },
  source: string
): T {

  if (result.error) {
    throw new Error(
      source + ': ' + explain(result.error)
    );
  }

  return result.data;
}

// GET ACTIVE SUPABASE CLIENT

function client() {

  if (!supabase) {
    throw new Error(
      'Not connected to Supabase'
    );
  }

  return supabase;
}

// LOAD SHARED TOURNAMENT DATA

export async function getCloudState():
  Promise<AppState> {

  if (!supabase) {
    return initial;
  }

  const [
    playerResult,
    drawResult,
    scoreResult,
    eventResult
  ] = await Promise.all([

    supabase
      .from('players')
      .select('name,handicap')
      .order('name'),

    supabase
      .from('pairs')
      .select('*')
      .order('group_no')
      .order('created_at'),

    supabase
      .from('hole_scores')
      .select('*'),

    supabase
      .from('events')
      .select('*')
      .eq('id', 'bbcdm-2026')
      .single()

  ]);

  const players = checked<any[] | null>(
    playerResult,
    'Players'
  );

  const pairs = checked<any[] | null>(
    drawResult,
    'Draw'
  );

  const scores = checked<any[] | null>(
    scoreResult,
    'Hole scores'
  );

  const event = checked<any>(
    eventResult,
    'Event'
  );

  return {

    players: (
      players ?? []
    ).map(player => ({
      name: player.name as string,

      handicap:
        player.handicap === null
          ? null
          : Number(player.handicap)
    })),

    pairs: (
      pairs ?? []
    ).map(pair => ({
      id: pair.id,

      players: [
        pair.player_a,
        pair.player_b
      ] as [string, string],

      group: Number(pair.group_no),

      startHole: Number(pair.start_hole),

      locked: Boolean(pair.locked),

      published: Boolean(pair.published),

      hcp:
        pair.team_handicap === null
          ? null
          : Number(pair.team_handicap)
    })),

    scores: (
      scores ?? []
    ).map(score => ({
      pairId: score.pair_id,

      hole: Number(score.hole),

      strokes: Number(score.strokes),

      drive: score.selected_drive,

      shots: Array.isArray(score.shots)
        ? score.shots
        : [],

      penalty: Number(score.penalty),

      version: Number(score.version ?? 0),

      completed: Boolean(score.completed),

      updatedAt: score.updated_at,

      updatedBy: score.submitted_by
    })),

    eventStatus:
      event.status as AppState['eventStatus'],

    published: Boolean(
      event.draw_published
    )

  };
}

// IDENTIFY LOGGED-IN PLAYER

export async function getRole():
  Promise<string> {

  if (!supabase) {
    return 'demo';
  }

  const {
    data,
    error
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error(
      explain(error)
    );
  }

  if (!data.user) {
    return 'guest';
  }

  // CHECK TOURNAMENT DIRECTOR ACCESS

  const director = checked(
    await supabase.rpc('is_admin'),
    'Director role'
  );

  if (director === true) {
    return 'director';
  }

  // IDENTIFY STANDARD PLAYER

  const account = checked<{
    player_name: string;
  } | null>(
    await supabase
      .from('player_accounts')
      .select('player_name')
      .eq('user_id', data.user.id)
      .maybeSingle(),
    'Player account'
  );

  return account?.player_name ?? 'guest';
}

// GET PRIVATE PARTNER PREFERENCES

export async function getPreferences():
  Promise<AvoidVote[]> {

  if (!supabase) {
    return [];
  }

  const data = checked<AvoidVote[] | null>(
    await supabase
      .from('pair_preferences')
      .select(
        'player_name,avoid_one,avoid_two'
      )
      .order('player_name'),
    'Preferences'
  );

  return data ?? [];
}

// SAVE PLAYER PARTNER PREFERENCES

export async function savePreference(
  playerName: string,
  a: string,
  b: string
): Promise<void> {

  const s = client();

  checked(
    await s
      .from('pair_preferences')
      .upsert(
        {
          player_name: playerName,

          avoid_one: a,

          avoid_two: b,

          updated_at:
            new Date().toISOString()
        },
        {
          onConflict: 'player_name'
        }
      )
      .select('player_name')
      .single(),
    'Save preferences'
  );
}

// PUBLISH OFFICIAL DRAW
// AND START LIVE SCORING

export async function launchDraw(
  pairs: Pair[]
): Promise<void> {

  const s = client();

  checked(
    await s.rpc(
      'launch_draw',
      {
        new_pairs: pairs.map(pair => ({
          id: pair.id,

          player_a: pair.players[0],

          player_b: pair.players[1],

          group_no: pair.group,

          start_hole: pair.startHole
        }))
      }
    ),
    'Launch draw'
  );
}

// SAVE SELECTED SHOTS ON ONE HOLE

export async function saveScore(
  score: Score
): Promise<number> {

  const s = client();

  const version = checked(
    await s.rpc(
      'save_selected_shots',
      {
        p_pair_id: score.pairId,

        p_hole: score.hole,

        p_shots: score.shots,

        p_penalty: score.penalty,

        p_expected_version: score.version,

        p_completed: score.completed
      }
    ),
    'Save hole'
  );

  return Number(version);
}

// LOAD PLAYER SCORECARD CONFIRMATIONS

export async function getConfirmations():
  Promise<Confirmation[]> {

  if (!supabase) {
    return [];
  }

  return checked<Confirmation[] | null>(
    await supabase
      .from('pair_confirmations')
      .select(
        'pair_id,player_name,confirmed_at'
      ),
    'Scorecard confirmations'
  ) ?? [];
}

// PLAYER CONFIRMS THEIR SCORECARD

export async function confirmRound(
  pairId: string
): Promise<void> {

  checked(
    await client().rpc(
      'confirm_round',
      {
        p_pair_id: pairId
      }
    ),
    'Confirm scorecard'
  );
}

// DIRECTOR FINALISES TOURNAMENT

export async function finaliseEvent():
  Promise<void> {

  checked(
    await client().rpc(
      'finalise_championship'
    ),
    'Finalise competition'
  );
}

// UPDATE APPROVED HANDICAP

export async function setPlayerHcp(
  name: string,
  handicap: number | null
): Promise<void> {

  checked(
    await client()
      .from('players')
      .update({
        handicap
      })
      .eq('name', name)
      .select('name')
      .single(),
    'Save handicap'
  );
}

// FOUR-DIGIT PIN LOGIN

export async function signInWithPin(
  name: string,
  pin: string
): Promise<void> {

  const s = client();

  // VERIFY PIN THROUGH SUPABASE EDGE FUNCTION

  const {
    data,
    error
  } = await s.functions.invoke(
    'player-login',
    {
      body: {
        player_name: name,
        pin
      }
    }
  );

  if (
    error ||
    !data?.token_hash
  ) {
    throw new Error(
      data?.error ||
      'PIN rejected or login unavailable'
    );
  }

  // EXCHANGE LOGIN TOKEN FOR USER SESSION

  checked(
    await s.auth.verifyOtp({
      token_hash: data.token_hash,
      type: 'magiclink'
    }),
    'Complete login'
  );
}

// PLAYER LOGOUT
// FIXED TYPESCRIPT ERROR TS2345

export async function signOut():
  Promise<void> {

  // Supabase signOut returns an error property.
  // It does not return the data property expected
  // by the checked() helper.

  const {
    error
  } = await client().auth.signOut();

  if (error) {
    throw new Error(
      'Sign out failed: ' +
      explain(error)
    );
  }
}
