
import {
  createClient
} from '@supabase/supabase-js';

import type {
  AppState,
  Pair,
  Score
} from './types';

import {
  initial
} from './engine';

const url = import.meta.env.VITE_SUPABASE_URL as
  string | undefined;

const key = import.meta.env.VITE_SUPABASE_ANON_KEY as
  string | undefined;

export const cloudEnabled = Boolean(
  url && key
);

export const supabase = cloudEnabled
  ? createClient(url!, key!)
  : null;

// Retrieve the latest shared tournament data.

export async function getCloudState():
  Promise<AppState> {

  if (!supabase) {
    return initial;
  }

  const [
    players,
    pairs,
    scores,
    event
  ] = await Promise.all([
    supabase
      .from('players')
      .select('name,handicap')
      .order('name'),

    supabase
      .from('pairs')
      .select('*')
      .order('created_at'),

    supabase
      .from('hole_scores')
      .select('*'),

    supabase
      .from('events')
      .select('*')
      .eq('id', 'bbcdm-2026')
      .single(),
  ]);

  for (const result of [
    players,
    pairs,
    scores,
    event
  ]) {
    if (result.error) {
      throw result.error;
    }
  }

  return {
    players: (
      players.data ?? []
    ).map(player => ({
      name: player.name as string,

      handicap:
        player.handicap === null
          ? null
          : Number(player.handicap),
    })),

    pairs: (
      pairs.data ?? []
    ).map(pair => ({
      id: pair.id as string,

      players: [
        pair.player_a,
        pair.player_b,
      ],

      group: Number(pair.group_no),

      startHole: Number(pair.start_hole),

      locked: Boolean(pair.locked),

      published: Boolean(pair.published),

      hcp:
        pair.team_handicap === null
          ? null
          : Number(pair.team_handicap),
    } as Pair)),

    scores: (
      scores.data ?? []
    ).map(score => ({
      pairId: score.pair_id,

      hole: Number(score.hole),

      strokes: Number(score.strokes),

      drive: score.selected_drive,

      penalty: Number(score.penalty),

      updatedBy: score.submitted_by,

      updatedAt: score.updated_at,
    } as Score)),

    eventStatus:
      event.data?.status as
        AppState['eventStatus'],

    published: Boolean(
      event.data?.draw_published
    ),
  };
}

// Identify the authenticated player.
// Director permissions come from Supabase,
// never from a selected name in the UI.

export async function getRole():
  Promise<string> {

  if (!supabase) {
    return 'demo';
  }

  const {
    data: session,
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError) {
    throw sessionError;
  }

  if (!session.user) {
    return 'guest';
  }

  const {
    data: director,
    error: directorError,
  } = await supabase.rpc(
    'is_admin'
  );

  if (directorError) {
    throw directorError;
  }

  if (director === true) {
    return 'director';
  }

  const {
    data: account,
    error: accountError,
  } = await supabase
    .from('player_accounts')
    .select('player_name')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (accountError) {
    throw accountError;
  }

  return account?.player_name ?? 'guest';
}

// Save one hole to Supabase.

export async function saveScore(
  score: Score
): Promise<void> {

  if (!supabase) {
    return;
  }

  const {
    error
  } = await supabase
    .from('hole_scores')
    .upsert(
      {
        pair_id: score.pairId,

        hole: score.hole,

        strokes: score.strokes,

        selected_drive: score.drive,

        penalty: score.penalty,
      },
      {
        onConflict: 'pair_id,hole',
      }
    )
    .select('pair_id')
    .single();

  if (error) {
    throw error;
  }
}

// Save the complete draw.
// Database validation checks for all 26 players.

export async function savePairs(
  pairs: Pair[]
): Promise<void> {

  if (!supabase) {
    return;
  }

  const {
    error
  } = await supabase.rpc(
    'replace_draw',
    {
      new_pairs: pairs.map(pair => ({
        id: pair.id,

        player_a: pair.players[0],

        player_b: pair.players[1],

        group_no: pair.group,

        start_hole: pair.startHole,

        locked: pair.locked,

        published: false,

        team_handicap: pair.hcp,
      })),
    }
  );

  if (error) {
    throw error;
  }
}

// Publish or hide the official draw.

export async function setPublish(
  published: boolean
): Promise<void> {

  if (!supabase) {
    return;
  }

  const {
    error
  } = await supabase
    .from('events')
    .update({
      draw_published: published
    })
    .eq('id', 'bbcdm-2026')
    .select('id')
    .single();

  if (error) {
    throw error;
  }
}

// Set event status:
// Registration, Draw, Live or Final.

export async function setStatus(
  status: AppState['eventStatus']
): Promise<void> {

  if (!supabase) {
    return;
  }

  const {
    error
  } = await supabase
    .from('events')
    .update({ status })
    .eq('id', 'bbcdm-2026')
    .select('id')
    .single();

  if (error) {
    throw error;
  }
}

// Update an approved player handicap.

export async function setPlayerHcp(
  name: string,
  handicap: number | null
): Promise<void> {

  if (!supabase) {
    return;
  }

  const {
    error
  } = await supabase
    .from('players')
    .update({ handicap })
    .eq('name', name)
    .select('name')
    .single();

  if (error) {
    throw error;
  }
}
