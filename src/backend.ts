
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

const url =
  import.meta.env.VITE_SUPABASE_URL as string | undefined;

const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudEnabled = Boolean(url && key);

export const supabase = cloudEnabled
  ? createClient(url!, key!)
  : null;

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
    ].filter(Boolean).join(' | ') || JSON.stringify(error);
  }

  return String(error);
};

function checked<T>(
  result: {
    data: T;
    error: unknown;
  },
  source: string
): T {

  if (result.error) {
    throw Error(
      source + ': ' + explain(result.error)
    );
  }

  return result.data;
}

function client() {
  if (!supabase) {
    throw Error('Not connected to Supabase');
  }

  return supabase;
}

// LOAD SHARED TOURNAMENT DATA

export async function getCloudState():
  Promise<AppState> {

  if (!supabase) return initial;

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
    ).map(p => ({
      name: p.name as string,
      handicap:
        p.handicap === null
          ? null
          : Number(p.handicap)
    })),

    pairs: (
      pairs ?? []
    ).map(p => ({
      id: p.id,
      players: [
        p.player_a,
        p.player_b
      ] as [string, string],
      group: Number(p.group_no),
      startHole: Number(p.start_hole),
      locked: Boolean(p.locked),
      published: Boolean(p.published),
      hcp:
        p.team_handicap === null
          ? null
          : Number(p.team_handicap)
    })),

    scores: (
      scores ?? []
    ).map(s => ({
      pairId: s.pair_id,
      hole: Number(s.hole),
      strokes: Number(s.strokes),
      drive: s.selected_drive,
      shots: Array.isArray(s.shots)
        ? s.shots
        : [],
      penalty: Number(s.penalty),
      version: Number(s.version ?? 0),
      completed: Boolean(s.completed),
      updatedAt: s.updated_at,
      updatedBy: s.submitted_by
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

  if (!supabase) return 'demo';

  const {
    data,
    error
  } = await supabase.auth.getUser();

  if (error) {
    throw Error(explain(error));
  }

  if (!data.user) {
    return 'guest';
  }

  const director = checked(
    await supabase.rpc('is_admin'),
    'Director role'
  );

  if (director === true) {
    return 'director';
  }

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

// PRIVATE PARTNER PREFERENCES

export async function getPreferences():
  Promise<AvoidVote[]> {

  if (!supabase) return [];

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

export async function savePreference(
  playerName: string,
  a: string,
  b: string
) {

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

// PUBLISH DRAW AND START LIVE SCORING

export async function launchDraw(
  pairs: Pair[]
) {

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

  if (!supabase) return [];

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
) {

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

// DIRECTOR FINALISES THE TOURNAMENT

export async function finaliseEvent() {

  checked(
    await client().rpc(
      'finalise_championship'
    ),
    'Finalise competition'
  );
}

// APPROVED HANDICAP UPDATES

export async function setPlayerHcp(
  name: string,
  handicap: number | null
) {

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

// FOUR-DIGIT PIN SIGN-IN

export async function signInWithPin(
  name: string,
  pin: string
) {

  const s = client();

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
    throw Error(
      data?.error ||
      'PIN rejected or login unavailable'
    );
  }

  checked(
    await s.auth.verifyOtp({
      token_hash: data.token_hash,
      type: 'magiclink'
    }),
    'Complete login'
  );
}

export async function signOut() {
  checked(
    await client().auth.signOut(),
    'Sign out'
  );
}
