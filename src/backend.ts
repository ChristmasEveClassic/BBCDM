
import { createClient } from '@supabase/supabase-js';
import type { AppState, Pair, Score } from './types';
import type { AvoidVote, Confirmation } from './competition2026';
import { initial } from './engine';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudEnabled = Boolean(url && key);

export const supabase = cloudEnabled
  ? createClient(url!, key!)
  : null;

export const explain = (error: unknown): string => {
  if (error && typeof error === 'object') {
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
  result: { data: T; error: unknown },
  source: string
): T {
  if (result.error) {
    throw new Error(source + ': ' + explain(result.error));
  }
  return result.data;
}

function client() {
  if (!supabase) {
    throw new Error('Not connected to Supabase');
  }
  return supabase;
}

export async function getCloudState(): Promise<AppState> {
  if (!supabase) return initial;

  const [playerResult, drawResult, scoreResult, eventResult] =
    await Promise.all([
      supabase.from('players')
        .select('name,handicap').order('name'),

      supabase.from('pairs')
        .select('*').order('group_no').order('created_at'),

      supabase.from('hole_scores').select('*'),

      supabase.from('events')
        .select('*').eq('id', 'bbcdm-2026').single()
    ]);

  const players = checked<any[] | null>(playerResult, 'Players');
  const pairs = checked<any[] | null>(drawResult, 'Draw');
  const scores = checked<any[] | null>(scoreResult, 'Hole scores');
  const event = checked<any>(eventResult, 'Event');

  return {
    players: (players ?? []).map(player => ({
      name: player.name as string,
      handicap: player.handicap === null
        ? null
        : Number(player.handicap)
    })),

    pairs: (pairs ?? []).map(pair => ({
      id: pair.id,
      players: [pair.player_a, pair.player_b] as [string, string],
      group: Number(pair.group_no),
      startHole: Number(pair.start_hole),
      locked: Boolean(pair.locked),
      published: Boolean(pair.published),
      hcp: pair.team_handicap === null
        ? null
        : Number(pair.team_handicap)
    })),

    scores: (scores ?? []).map(score => ({
      pairId: score.pair_id,
      hole: Number(score.hole),
      strokes: Number(score.strokes),
      drive: score.selected_drive,
      shots: Array.isArray(score.shots) ? score.shots : [],
      penalty: Number(score.penalty),
      version: Number(score.version ?? 0),
      completed: Boolean(score.completed),
      updatedAt: score.updated_at,
      updatedBy: score.submitted_by
    })),

    eventStatus: event.status as AppState['eventStatus'],
    published: Boolean(event.draw_published)
  };
}

export async function getRole(): Promise<string> {
  if (!supabase) return 'demo';

  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(explain(error));
  if (!data.user) return 'guest';

  const director = checked(
    await supabase.rpc('is_admin'),
    'Director role'
  );

  if (director === true) return 'director';

  const account = checked<{
    player_name: string;
  } | null>(
    await supabase.from('player_accounts')
      .select('player_name')
      .eq('user_id', data.user.id)
      .maybeSingle(),
    'Player account'
  );

  return account?.player_name ?? 'guest';
}

export async function getPreferences(): Promise<AvoidVote[]> {
  if (!supabase) return [];

  return checked<AvoidVote[] | null>(
    await supabase.from('pair_preferences')
      .select('player_name,avoid_one,avoid_two')
      .order('player_name'),
    'Preferences'
  ) ?? [];
}

export async function savePreference(
  playerName: string,
  a: string,
  b: string
): Promise<void> {
  checked(
    await client().from('pair_preferences').upsert(
      {
        player_name: playerName,
        avoid_one: a,
        avoid_two: b,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'player_name' }
    ).select('player_name').single(),
    'Save preferences'
  );
}

export async function launchDraw(pairs: Pair[]): Promise<void> {
  checked(
    await client().rpc('launch_draw', {
      new_pairs: pairs.map(pair => ({
        id: pair.id,
        player_a: pair.players[0],
        player_b: pair.players[1],
        group_no: pair.group,
        start_hole: pair.startHole
      }))
    }),
    'Launch draw'
  );
}

export async function saveScore(score: Score): Promise<number> {
  const result = checked<unknown>(
    await client().rpc('save_selected_shots', {
      p_pair_id: score.pairId,
      p_hole: score.hole,
      p_shots: score.shots,
      p_penalty: score.penalty,
      p_expected_version: score.version,
      p_completed: score.completed
    }),
    'Save hole'
  );

  const version = Number(result);

  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(
      'Supabase returned an invalid score version. Reload the scorecard before editing.'
    );
  }

  return version;
}

export async function deleteScore(
  pairId: string,
  hole: number,
  expectedVersion: number
): Promise<void> {
  checked(
    await client().rpc('delete_hole_score', {
      p_pair_id: pairId,
      p_hole: hole,
      p_expected_version: expectedVersion
    }),
    'Reset saved hole'
  );
}

export async function getConfirmations(): Promise<Confirmation[]> {
  if (!supabase) return [];

  return checked<Confirmation[] | null>(
    await supabase.from('pair_confirmations')
      .select('pair_id,player_name,confirmed_at'),
    'Scorecard confirmations'
  ) ?? [];
}

export async function confirmRound(pairId: string): Promise<void> {
  checked(
    await client().rpc('confirm_round', {
      p_pair_id: pairId
    }),
    'Confirm scorecard'
  );
}

export async function finaliseEvent(): Promise<void> {
  checked(
    await client().rpc('finalise_championship'),
    'Finalise competition'
  );
}

export async function setPlayerHcp(
  name: string,
  handicap: number | null
): Promise<void> {
  checked(
    await client().from('players')
      .update({ handicap })
      .eq('name', name)
      .select('name')
      .single(),
    'Save handicap'
  );
}

export async function signInWithPin(
  name: string,
  pin: string
): Promise<void> {
  const s = client();

  const { data, error } = await s.functions.invoke(
    'player-login',
    {
      body: {
        player_name: name,
        pin
      }
    }
  );

  if (error || !data?.token_hash) {
    throw new Error(
      data?.error || 'PIN rejected or login unavailable'
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

export async function signOut(): Promise<void> {
  const { error } = await client().auth.signOut();

  if (error) {
    throw new Error('Sign out failed: ' + explain(error));
  }
}
