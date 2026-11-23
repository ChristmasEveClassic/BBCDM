
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  Flag,
  Users,
  Trophy,
  CalendarDays,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  Shield,
  LogIn,
  ChevronRight,
  Check,
  Shuffle,
  Lock,
  Unlock,
  Clock,
  MapPin,
  AlertTriangle,
  RefreshCw,
  WifiOff,
  UserRound,
  Medal,
  Save,
} from 'lucide-react';

import {
  cloudEnabled,
  getCloudState,
  getRole,
  savePairs,
  saveScore,
  setPlayerHcp,
  setPublish,
  setStatus,
  supabase,
} from './backend';

import {
  committee,
  course,
  driveCounts,
  founders,
  initial,
  ordinal,
  pairScores,
  playerHistory,
  randomPairs,
  results,
  sharedPastPartners,
  shotgunOrder,
  standings,
  stats,
  validateDraw,
  venues,
} from './engine';

import type {
  AppState,
  Pair,
  Score,
} from './types';

import './style.css';

// Navigation

type Tab =
  | 'home'
  | 'field'
  | 'history'
  | 'champions'
  | 'draw'
  | 'scoring'
  | 'leaderboard'
  | 'rules'
  | 'admin';

const sections: {
  id: Tab;
  label: string;
  icon: typeof Flag;
}[] = [
  { id: 'home', label: 'Home', icon: Flag },
  { id: 'field', label: 'The Field', icon: Users },
  { id: 'history', label: 'History', icon: BookOpen },
  { id: 'champions', label: 'Champions', icon: Trophy },
  { id: 'draw', label: 'The Draw', icon: Shuffle },
  { id: 'scoring', label: 'Scoring', icon: ClipboardList },
  { id: 'leaderboard', label: 'Leaderboard', icon: Medal },
  { id: 'rules', label: 'Rules', icon: Shield },
  { id: 'admin', label: 'Admin', icon: LayoutDashboard },
];

const years = [
  2025,
  2024,
  2023,
  2022,
  2021,
  2020,
];

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function App() {

  // APPLICATION STATE

  const [state, setState] = useState<AppState>(() => {
    try {
      return (
        JSON.parse(
          localStorage.getItem('bbcdm_demo_state') || 'null'
        ) || initial
      );
    } catch {
      return initial;
    }
  });

  const [tab, setTab] = useState<Tab>('home');

  const [selected, setSelected] = useState(
    'Joshua Clarke'
  );

  const [year, setYear] = useState(2025);

  // AUTHENTICATION

  const [role, setRole] = useState(
    cloudEnabled ? 'guest' : 'demo'
  );

  const [loginPlayer, setLoginPlayer] = useState(
    'Joshua Clarke'
  );

  const [pin, setPin] = useState('');

  const [loading, setLoading] = useState(false);

  const [message, setMessage] = useState('');

  // CONNECTION

  const [online, setOnline] = useState(
    navigator.onLine
  );

  // PAIR MANAGEMENT

  const [draftPairs, setDraftPairs] = useState<
    Pair[] | null
  >(null);

  const [hcpDrafts, setHcpDrafts] = useState<
    Record<string, string>
  >({});

  // SCORING

  const [selectedPair, setSelectedPair] = useState('');

  const [holeIndex, setHoleIndex] = useState(0);

  const [strokes, setStrokes] = useState(4);

  const [drive, setDrive] = useState('');

  const [penalty, setPenalty] = useState(0);

  // OFFLINE SCORE QUEUE

  const [pending, setPending] = useState<Score[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem('bbcdm_pending') || '[]'
      );
    } catch {
      return [];
    }
  });

  // USER PERMISSIONS

  // Supabase identifies the Tournament Director.
  // Choosing Joshua Clarke from the list does not
  // grant Director access.

  const admin =
    role === 'director' ||
    (!cloudEnabled && role === 'demo');

  const signedIn = role !== 'guest';

  const canEnterScores =
    signedIn &&
    state.eventStatus === 'live';

  // Players see their assigned pair.
  // Director sees all pairs.

  const visiblePairs = admin
    ? state.pairs
    : state.pairs.filter(pair =>
        pair.players.includes(role)
      );

  const workingPairs =
    admin && draftPairs !== null
      ? draftPairs
      : state.pairs;

  const scorePair =
    visiblePairs.find(pair =>
      pair.id === selectedPair
    ) || visiblePairs[0];

  const scoreHoles = scorePair
    ? shotgunOrder(scorePair.startHole)
    : [];

  const holeNumber =
    scoreHoles[holeIndex] || 1;

  const holeData =
    course.find(
      hole => hole.hole === holeNumber
    ) || course[0];

  const currentRecord = scorePair
    ? state.scores.find(
        score =>
          score.pairId === scorePair.id &&
          score.hole === holeNumber
      )
    : undefined;

  // LIVE LEADERBOARD

  const leaderboard = useMemo(
    () => standings(state),
    [state]
  );

  // PLAYER HISTORY

  const history = playerHistory(selected);

  const playerStats = stats(selected);

  // SAVE LOCAL STATE

  useEffect(() => {
    localStorage.setItem(
      'bbcdm_demo_state',
      JSON.stringify(state)
    );
  }, [state]);

  useEffect(() => {
    localStorage.setItem(
      'bbcdm_pending',
      JSON.stringify(pending)
    );
  }, [pending]);

  // CONNECTION MONITORING

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);

    window.addEventListener('online', on);
    window.addEventListener('offline', off);

    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // SUPABASE ACCOUNT AND DATA REFRESH

  useEffect(() => {
    if (!supabase) return;

    let active = true;
    let sequence = 0;

    const refresh = async () => {
      const current = ++sequence;

      // Retrieve account role independently from
      // tournament data to preserve Director access.

      const [who, latest] = await Promise.allSettled([
        getRole(),
        getCloudState(),
      ]);

      if (!active || current !== sequence) {
        return;
      }

      if (who.status === 'fulfilled') {
        setRole(who.value);
      } else {
        setMessage(
          'Account permissions error: ' +
          errorText(who.reason)
        );
      }

      if (latest.status === 'fulfilled') {
        setState(latest.value);
      } else {
        setMessage(
          'Cloud data error: ' +
          errorText(latest.reason)
        );
      }
    };

    void refresh();

    // Refresh when someone signs in or out.

    const { data: listener } =
      supabase.auth.onAuthStateChange(() => {
        window.setTimeout(() => {
          void refresh();
        }, 0);
      });

    // Listen for database changes.

    const sub = supabase
      .channel('bbcdm-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
        },
        () => {
          void refresh();
        }
      )
      .subscribe();

    // Periodic refresh for score and draw updates.

    const timer = window.setInterval(() => {
      if (navigator.onLine) {
        void refresh();
      }
    }, 30000);

    const focus = () => {
      if (!document.hidden) {
        void refresh();
      }
    };

    document.addEventListener(
      'visibilitychange',
      focus
    );

    return () => {
      active = false;

      listener.subscription.unsubscribe();

      void supabase?.removeChannel(sub);

      window.clearInterval(timer);

      document.removeEventListener(
        'visibilitychange',
        focus
      );
    };
  }, []);

  // OFFLINE SCORE SYNCHRONISATION

  useEffect(() => {
    if (
      !online ||
      !supabase ||
      pending.length === 0
    ) {
      return;
    }

    let cancelled = false;

    const sync = async () => {
      try {
        const latest = await getCloudState();

        for (const queued of pending) {
          if (cancelled) return;

          const remote = latest.scores.find(
            score =>
              score.pairId === queued.pairId &&
              score.hole === queued.hole
          );

          const newer =
            remote &&
            Date.parse(remote.updatedAt) >
              Date.parse(queued.updatedAt);

          const different =
            remote &&
            (
              remote.strokes !== queued.strokes ||
              remote.drive !== queued.drive ||
              remote.penalty !== queued.penalty
            );

          if (newer && different) {
            setMessage(
              `Offline score conflict on hole ${queued.hole}. ` +
              'Ask the Director to check before resubmitting.'
            );

            return;
          }

          await saveScore(queued);

          setPending(old =>
            old.filter(
              score =>
                !(
                  score.pairId === queued.pairId &&
                  score.hole === queued.hole
                )
            )
          );
        }

        if (!cancelled) {
          setState(await getCloudState());
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            'Offline scores not yet synced: ' +
            errorText(error)
          );
        }
      }
    };

    void sync();

    return () => {
      cancelled = true;
    };
  }, [online, pending.length]);

  // SCORECARD INPUT STATE

  useEffect(() => {
    if (currentRecord) {
      setStrokes(currentRecord.strokes);
      setDrive(currentRecord.drive);
      setPenalty(currentRecord.penalty);
    } else {
      setStrokes(holeData.par);
      setDrive('');
      setPenalty(0);
    }
  }, [
    scorePair?.id,
    holeNumber,
    currentRecord?.updatedAt,
  ]);

  // MANUAL CLOUD REFRESH

  async function refreshCloud() {
    if (!cloudEnabled) return;

    // Load permissions first so a problem fetching
    // tournament data does not hide Director controls.

    const newRole = await getRole();

    setRole(newRole);

    try {
      const newState = await getCloudState();

      setState(newState);
    } catch (error) {
      setMessage(
        'Tournament data unavailable: ' +
        errorText(error)
      );
    }
  }

  // FOUR-DIGIT PLAYER PIN LOGIN

  async function signIn() {
    if (
      !supabase ||
      loading ||
      pin.length !== 4
    ) {
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const { data, error } =
        await supabase.functions.invoke(
          'player-login',
          {
            body: {
              player_name: loginPlayer,
              pin,
            },
          }
        );

      if (error || !data?.token_hash) {
        throw new Error(
          data?.error ||
          'Login failed. Check your PIN or ask the Director if the account is locked.'
        );
      }

      // Exchange the one-time token for
      // a real Supabase user session.

      const { error: sessionError } =
        await supabase.auth.verifyOtp({
          token_hash: data.token_hash,
          type: 'magiclink',
        });

      if (sessionError) {
        throw sessionError;
      }

      setPin('');

      setSelected(loginPlayer);

      await refreshCloud();

      setTab('history');

      setMessage(
        `Welcome, ${loginPlayer}.`
      );
    } catch (error) {
      setMessage(
        'Login error: ' +
        errorText(error)
      );
    } finally {
      setLoading(false);
    }
  }

  // PLAYER LOGOUT

  async function signOut() {
    if (!supabase) return;

    const { error } =
      await supabase.auth.signOut();

    if (error) {
      setMessage(error.message);
      return;
    }

    setRole('guest');

    setPin('');

    setTab('home');

    setMessage('Signed out.');
  }

  // SAVE A HOLE SCORE

  async function saveCurrent() {
    if (!scorePair || !canEnterScores) {
      setMessage(
        'Scoring opens when the Director sets the event to Live.'
      );

      return;
    }

    if (!drive) {
      setMessage(
        'Select whose tee shot was used.'
      );

      return;
    }

    const entry: Score = {
      pairId: scorePair.id,
      hole: holeNumber,
      strokes,
      drive,
      penalty,
      updatedAt: new Date().toISOString(),
    };

    // Save offline data on this device.

    if (cloudEnabled && !online) {
      setPending(old => [
        ...old.filter(
          score =>
            !(
              score.pairId === entry.pairId &&
              score.hole === entry.hole
            )
        ),
        entry,
      ]);

      setState(old => ({
        ...old,
        scores: [
          ...old.scores.filter(
            score =>
              !(
                score.pairId === entry.pairId &&
                score.hole === entry.hole
              )
          ),
          entry,
        ],
      }));

      setMessage(
        'Offline copy only. This score is NOT official until it syncs.'
      );
    } else {
      try {
        await saveScore(entry);

        if (cloudEnabled) {
          setState(await getCloudState());
        } else {
          setState(old => ({
            ...old,
            scores: [
              ...old.scores.filter(
                score =>
                  !(
                    score.pairId === entry.pairId &&
                    score.hole === entry.hole
                  )
              ),
              entry,
            ],
          }));
        }

        setMessage(
          `Hole ${holeNumber} saved.`
        );
      } catch (error) {
        setMessage(
          'Score was NOT submitted: ' +
          errorText(error)
        );

        return;
      }
    }

    setHoleIndex(old =>
      Math.min(17, old + 1)
    );
  }

  // TOURNAMENT DIRECTOR: GENERATE DRAW

  async function generateDraw() {
    if (!admin) return;

    if (
      state.eventStatus === 'live' ||
      state.eventStatus === 'final' ||
      state.scores.length > 0
    ) {
      setMessage(
        'You cannot redraw once scoring has started.'
      );

      return;
    }

    try {
      const pairs = randomPairs({
        ...state,
        pairs: workingPairs,
      });

      const problem = validateDraw(
        pairs,
        state.players.map(player => player.name)
      );

      if (problem) {
        throw new Error(problem);
      }

      await savePairs(pairs);

      setDraftPairs(null);

      if (cloudEnabled) {
        await refreshCloud();
      } else {
        setState(old => ({
          ...old,
          pairs,
          published: false,
        }));
      }

      setTab('draw');

      setMessage(
        '13 pairs generated. Review group starting holes before publishing.'
      );
    } catch (error) {
      setMessage(
        'Draw error: ' +
        errorText(error)
      );
    }
  }

  // TOURNAMENT DIRECTOR: SAVE ASSIGNMENTS

  async function saveDraw() {
    if (!admin) return;

    const pairs =
      draftPairs ?? state.pairs;

    const problem = validateDraw(
      pairs,
      state.players.map(player => player.name)
    );

    if (problem) {
      setMessage(problem);
      return;
    }

    try {
      await savePairs(pairs);

      setDraftPairs(null);

      if (cloudEnabled) {
        await refreshCloud();
      } else {
        setState(old => ({
          ...old,
          pairs,
          published: false,
        }));
      }

      setMessage(
        'Assignments saved. Publish the draw again when ready.'
      );
    } catch (error) {
      setMessage(
        'Could not save draw: ' +
        errorText(error)
      );
    }
  }

  // TOURNAMENT DIRECTOR: PUBLISH DRAW

  async function publishDraw() {
    if (!admin) return;

    if (
      !state.published &&
      draftPairs
    ) {
      setMessage(
        'Save your group and hole changes before publishing.'
      );

      return;
    }

    if (!state.published) {
      const problem = validateDraw(
        state.pairs,
        state.players.map(player => player.name)
      );

      if (problem) {
        setMessage(problem);
        return;
      }
    }

    try {
      await setPublish(
        !state.published
      );

      if (cloudEnabled) {
        await refreshCloud();
      } else {
        setState(old => ({
          ...old,
          published: !old.published,
        }));
      }

      setMessage(
        state.published
          ? 'Draw hidden.'
          : 'Draw published to players.'
      );
    } catch (error) {
      setMessage(
        'Publish failed: ' +
        errorText(error)
      );
    }
  }

  // TOURNAMENT DIRECTOR: EVENT STATUS

  async function changeStatus(
    status: AppState['eventStatus']
  ) {
    if (!admin) return;

    try {
      await setStatus(status);

      if (cloudEnabled) {
        await refreshCloud();
      } else {
        setState(old => ({
          ...old,
          eventStatus: status,
        }));
      }

      setMessage(
        status === 'live'
          ? 'Live scoring is now open.'
          : `Event status: ${status}.`
      );
    } catch (error) {
      setMessage(
        'Status not changed: ' +
        errorText(error)
      );
    }
  }

  // TOURNAMENT DIRECTOR: PLAYER HANDICAPS

  async function commitHandicap(
    name: string
  ) {
    const raw = hcpDrafts[name];

    if (raw === undefined) return;

    const value =
      raw.trim() === ''
        ? null
        : Number(raw);

    if (
      value !== null &&
      (
        !Number.isFinite(value) ||
        value < -10 ||
        value > 60
      )
    ) {
      setMessage(
        'Handicap must be between -10 and 60.'
      );

      return;
    }

    try {
      await setPlayerHcp(
        name,
        value
      );

      if (cloudEnabled) {
        await refreshCloud();
      } else {
        setState(old => ({
          ...old,
          players: old.players.map(player =>
            player.name === name
              ? {
                  ...player,
                  handicap: value,
                }
              : player
          ),
        }));
      }

      setHcpDrafts(old => {
        const next = { ...old };
        delete next[name];
        return next;
      });

      setMessage(
        `${name}: handicap saved.`
      );
    } catch (error) {
      setMessage(
        'Handicap not saved: ' +
        errorText(error)
      );
    }
  }

  // EDIT PAIR BEFORE SAVING

  function editPair(
    id: string,
    change: Partial<Pair>
  ) {
    setDraftPairs(old =>
      (old ?? state.pairs).map(pair =>
        pair.id === id
          ? { ...pair, ...change }
          : pair
      )
    );
  }

  // COMMON PAGE HEADING

  const heading = (
    eyebrow: string,
    title: string,
    desc?: string
  ) => (
    <div className="page-heading">
      <span className="eyebrow">
        {eyebrow}
      </span>

      <h2>{title}</h2>

      {desc && <p>{desc}</p>}
    </div>
  );

  // MAIN INTERFACE

  return (
    <div className="app-shell">

      {/* HEADER */}

      <header className="top">

        <div
          className="brand"
          onClick={() => setTab('home')}
        >
          <div className="brand-icon">
            <Flag size={24} />
          </div>

          <div>
            <strong>BBCDM</strong>
            <span>CHRISTMAS EVE CLASSIC</span>
          </div>
        </div>

        <div className="top-right">

          <span className="edition">
            THE GOLD STANDARD · VII
          </span>

          <button
            className="icon-button"
            title="Account"
            onClick={() => setTab('admin')}
          >
            <UserRound size={19} />
          </button>

        </div>
      </header>

      {/* NAVIGATION */}

      <nav className="nav">
        {sections.map(section => (
          <button
            key={section.id}
            className={
              tab === section.id
                ? 'active'
                : ''
            }
            onClick={() => {
              setTab(section.id);
              setMessage('');
            }}
          >
            <section.icon size={17} />
            <span>{section.label}</span>
          </button>
        ))}
      </nav>

      <main>

        {/* CONNECTION STATUS */}

        {!cloudEnabled && (
          <div className="demo-bar">
            <AlertTriangle size={16} />
            Local preview. Connect Supabase to share data between phones.
          </div>
        )}

        {!online && (
          <div className="offline">
            <WifiOff size={16} />
            Offline: unsynced scores are not official.
          </div>
        )}

        {message && (
          <div
            className="notice"
            onClick={() => setMessage('')}
          >
            {message}
            <span>×</span>
          </div>
        )}

        {/* HOME */}

        {tab === 'home' && (
          <>
            <section className="hero">

              <span className="eyebrow">
                THE SEVENTH EDITION · 2026
              </span>

              <h1>
                Christmas Eve
                <br />
                <em>Classic.</em>
              </h1>

              <p>
                Seven years. One championship.
                The Gold Standard.
              </p>

              <div className="hero-meta">

                <span>
                  <CalendarDays size={16} />
                  Thu 24 December
                </span>

                <span>
                  <MapPin size={16} />
                  Clare Golf Club
                </span>

                <span>
                  <Clock size={16} />
                  9:15 AM Shotgun
                </span>

              </div>
            </section>

            <div className="stats-grid">

              <Stat
                label="Selected field"
                value={state.players.length}
              />

              <Stat
                label="Ambrose pairs"
                value={state.pairs.length || 13}
              />

              <Stat
                label="Championship"
                value="7th"
              />

              <Stat
                label="Course par"
                value="72"
              />

            </div>

            <div className="section-label">
              THE CHAMPIONSHIP
            </div>

            <div className="action-grid">

              <Action
                title="The Field"
                sub="Every competitor. Every record."
                icon={<Users />}
                onClick={() => setTab('field')}
              />

              <Action
                title="The Draw"
                sub="See partners and starting holes."
                icon={<Shuffle />}
                onClick={() => setTab('draw')}
              />

              <Action
                title="Live Leaderboard"
                sub="Follow scores as they arrive."
                icon={<Medal />}
                onClick={() => setTab('leaderboard')}
              />

            </div>

            <div className="split">

              <div className="panel">

                <span className="eyebrow">
                  TITLE HOLDERS
                </span>

                <h3>Defending champions</h3>

                <p className="strong">
                  Duncan Bussenschutt
                  <br />
                  Dylan March
                  <br />
                  Jared O&apos;Donohue
                </p>

                <p>
                  Copperclub Golf Club · 2025 · 62 net
                </p>

              </div>

              <div className="panel">

                <span className="eyebrow">
                  THE FORMAT
                </span>

                <h3>2-Man Ambrose</h3>

                <p>
                  18 holes. Two players per team.
                  Six selected tee shots minimum per player.
                </p>

                <button
                  className="text-button"
                  onClick={() => setTab('rules')}
                >
                  Official rules
                  <ChevronRight size={16} />
                </button>

              </div>

            </div>
          </>
        )}

        {/* THE FIELD */}

        {tab === 'field' && (
          <>
            {heading(
              'OFFICIAL 2026 FIELD',
              'The Competitors',
              '26 selected players. Player profiles and results from 2020–2025.'
            )}

            <div className="field-grid">

              {state.players.map((player, index) => {
                const record = stats(player.name);

                return (
                  <button
                    className="player-card"
                    key={player.name}
                    onClick={() => {
                      setSelected(player.name);
                      setTab('history');
                    }}
                  >
                    <span className="player-no">
                      {String(index + 1).padStart(2, '0')}
                    </span>

                    <strong>{player.name}</strong>

                    <div className="player-stat">
                      {record.starts} starts · {record.titles} titles
                    </div>

                    {founders.includes(player.name) && (
                      <span className="mini-badge">
                        FOUNDING MEMBER
                      </span>
                    )}

                    <ChevronRight
                      className="arrow"
                      size={17}
                    />

                  </button>
                );
              })}

            </div>
          </>
        )}

        {/* PLAYER HISTORY */}

        {tab === 'history' && (
          <>
            {heading(
              'THE BBCDM ARCHIVE',
              'Player History',
              'Every documented finishing position, score and partnership.'
            )}

            <div className="panel profile">

              <select
                aria-label="Choose player"
                value={selected}
                onChange={event =>
                  setSelected(event.target.value)
                }
              >
                {[
                  ...new Set([
                    ...state.players.map(player => player.name),
                    ...results.flatMap(result => result.players),
                  ]),
                ]
                  .sort()
                  .map(name => (
                    <option
                      key={name}
                      value={name}
                    >
                      {name}
                    </option>
                  ))}
              </select>

              <h3>{selected}</h3>

              <div className="profile-badges">

                {founders.includes(selected) && (
                  <span className="tag">
                    FOUNDING MEMBER
                  </span>
                )}

                {committee[selected] && (
                  <span className="tag">
                    {committee[selected]}
                  </span>
                )}

              </div>

              <div className="stats-grid">

                <Stat
                  label="Starts"
                  value={playerStats.starts}
                />

                <Stat
                  label="Titles"
                  value={playerStats.titles}
                />

                <Stat
                  label="Best finish"
                  value={playerStats.best || '—'}
                />

                <Stat
                  label="Debut"
                  value={playerStats.debut || '—'}
                />

              </div>

              <h4>Year-by-year results</h4>

              <div className="responsive-table">

                <table>
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Finish</th>
                      <th>Score</th>
                      <th>Partner(s)</th>
                    </tr>
                  </thead>

                  <tbody>

                    {history.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          No documented starts.
                        </td>
                      </tr>
                    ) : (
                      history.map((record, index) => (
                        <tr
                          key={`${record.year}-${index}`}
                        >
                          <td>
                            {record.year}
                          </td>

                          <td
                            className={
                              record.position === '1st'
                                ? 'gold'
                                : ''
                            }
                          >
                            {ordinal(record.position)}

                            {record.verification === 'pending' && (
                              <span
                                className="pending"
                                title="Record pending verification"
                              >
                                †
                              </span>
                            )}
                          </td>

                          <td>
                            {record.score === null
                              ? '—'
                              : `${record.score} ${
                                  record.year === 2022
                                    ? 'pts'
                                    : 'net'
                                }`}
                          </td>

                          <td>
                            {record.players
                              .filter(name => name !== selected)
                              .join(', ') || 'Individual'}
                          </td>

                        </tr>
                      ))
                    )}

                  </tbody>
                </table>

              </div>

              <p className="fine-print">
                † Pending archive verification.
                The 2022 competition used Stableford points.
              </p>

            </div>

            <div className="panel archive">

              <div className="bar-row">

                <h3>Historical tournaments</h3>

                <select
                  value={year}
                  onChange={event =>
                    setYear(Number(event.target.value))
                  }
                >
                  {years.map(value => (
                    <option
                      key={value}
                      value={value}
                    >
                      {value}
                    </option>
                  ))}
                </select>

              </div>

              <p>
                {venues[String(year)]?.[0]} ·{' '}
                {venues[String(year)]?.[1]}
              </p>

              <div className="responsive-table">

                <table>

                  <thead>
                    <tr>
                      <th>Place</th>
                      <th>Players</th>
                      <th>Score</th>
                    </tr>
                  </thead>

                  <tbody>
                    {results
                      .filter(result => result.year === year)
                      .map((record, index) => (
                        <tr key={index}>

                          <td
                            className={
                              record.position === '1st'
                                ? 'gold'
                                : ''
                            }
                          >
                            {ordinal(record.position)}
                          </td>

                          <td>
                            {record.players.join(' · ')}
                          </td>

                          <td>
                            {record.score ?? '—'}
                          </td>

                        </tr>
                      ))}
                  </tbody>

                </table>

              </div>

            </div>
          </>
        )}

        {/* CHAMPIONS */}

        {tab === 'champions' && (
          <>
            {heading(
              'THE HONOUR BOARD',
              'Champions',
              'Every winner since 2020.'
            )}

            <div className="champ-grid">

              {years.map(value => {
                const winner = results.find(
                  result =>
                    result.year === value &&
                    result.position === '1st'
                );

                return (
                  <div
                    className="champ"
                    key={value}
                  >

                    <span>
                      {value} · {venues[String(value)]?.[0]}
                    </span>

                    <Trophy
                      color="#b8933a"
                      size={24}
                    />

                    <h3>
                      {winner?.players.join(' & ')}
                    </h3>

                    <p>
                      {winner?.score ?? '—'}{' '}
                      {value === 2022
                        ? 'Stableford points'
                        : 'net strokes'}
                    </p>

                  </div>
                );
              })}

            </div>
          </>
        )}

        {/* THE DRAW */}

        {tab === 'draw' && (
          <>
            {heading(
              '2026 CHAMPIONSHIP',
              'The Draw',
              state.published
                ? 'Official pairs and shotgun assignments.'
                : 'The Director will publish pairs before play.'
            )}

            {admin && (
              <div className="panel">

                <h3>Director draw controls</h3>

                <p>
                  Groups 1–5 have two pairs.
                  Group 6 has three pairs.
                  Give all pairs in a group the same
                  starting hole. Confirm starting holes
                  with Clare Golf Club.
                </p>

                <div className="btn-row">

                  <button
                    onClick={() =>
                      void generateDraw()
                    }
                  >
                    <Shuffle size={16} />
                    Generate random pairs
                  </button>

                  <button
                    className="primary"
                    onClick={() =>
                      void saveDraw()
                    }
                  >
                    <Save size={16} />
                    Save assignments
                  </button>

                  <button
                    onClick={() =>
                      void publishDraw()
                    }
                  >
                    {state.published
                      ? 'Hide draw'
                      : 'Publish draw'}
                  </button>

                </div>

                {draftPairs && (
                  <p className="fine-print">
                    Unsaved edits. Select Save assignments
                    before publishing.
                  </p>
                )}

              </div>
            )}

            {!state.published && !admin ? (
              <div className="empty">

                <Lock size={38} />

                <h3>
                  Pairings are under wraps.
                </h3>

                <p>
                  Return here after the Director
                  publishes the draw.
                </p>

              </div>
            ) : workingPairs.length === 0 ? (
              <div className="empty">

                <Shuffle size={38} />

                <h3>
                  No pairs assigned yet.
                </h3>

              </div>
            ) : (
              <div className="pair-grid">

                {workingPairs.map((pair, index) => (
                  <div
                    className="pair-card"
                    key={pair.id}
                  >

                    <div className="bar-row">

                      <span className="eyebrow">
                        PAIR {String(index + 1).padStart(2, '0')}
                      </span>

                      <span className="tag">
                        GROUP {pair.group}
                      </span>

                    </div>

                    <h3>
                      {pair.players[0]}

                      <span className="amp">
                        {' '}&{' '}
                      </span>

                      {pair.players[1]}
                    </h3>

                    <p>
                      Starting hole {pair.startHole}
                      {' '}· Team HCP{' '}
                      {pair.hcp === null
                        ? 'TBC'
                        : pair.hcp.toFixed(2)}
                    </p>

                    <small>
                      Past partnership:{' '}
                      {sharedPastPartners(
                        pair.players[0],
                        pair.players[1]
                      ).join(', ') || 'None recorded'}
                    </small>

                    {admin && (
                      <div className="pair-tools">

                        <button
                          onClick={() =>
                            editPair(
                              pair.id,
                              {
                                locked: !pair.locked,
                              }
                            )
                          }
                        >
                          {pair.locked ? (
                            <Unlock size={15} />
                          ) : (
                            <Lock size={15} />
                          )}

                          {pair.locked
                            ? 'Unlock'
                            : 'Lock'}
                        </button>

                        <label>
                          Group

                          <input
                            type="number"
                            min="1"
                            max="6"
                            value={pair.group}
                            onChange={event =>
                              editPair(
                                pair.id,
                                {
                                  group: Number(
                                    event.target.value
                                  ),
                                }
                              )
                            }
                          />
                        </label>

                        <label>
                          Start

                          <input
                            type="number"
                            min="1"
                            max="18"
                            value={pair.startHole}
                            onChange={event =>
                              editPair(
                                pair.id,
                                {
                                  startHole: Number(
                                    event.target.value
                                  ),
                                }
                              )
                            }
                          />
                        </label>

                      </div>
                    )}

                  </div>
                ))}

              </div>
            )}
          </>
        )}

        {/* LIVE SCORING */}

        {tab === 'scoring' && (
          <>
            {heading(
              'ON COURSE',
              'Live Scorecard',
              'Enter gross strokes, selected drive and approved penalties on every hole.'
            )}

            {!signedIn ? (
              <div className="empty">

                <Lock size={38} />

                <h3>
                  Log in to record scores.
                </h3>

                <button
                  className="primary"
                  onClick={() => setTab('admin')}
                >
                  Player login
                </button>

              </div>
            ) : state.eventStatus !== 'live' ? (
              <div className="empty">

                <Clock size={38} />

                <h3>
                  Scoring has not started.
                </h3>

                <p>
                  The Director will change Event status
                  to Live at the shotgun start.
                </p>

              </div>
            ) : !scorePair ? (
              <div className="empty">

                <ClipboardList size={38} />

                <h3>
                  No scorecard assigned.
                </h3>

                <p>
                  Check your published pair or ask
                  the Director to verify your player account.
                </p>

              </div>
            ) : (
              <>
                <div className="panel score-panel">

                  <div className="bar-row">

                    <label className="field-label">
                      Your pair

                      <select
                        value={scorePair.id}
                        onChange={event => {
                          setSelectedPair(event.target.value);
                          setHoleIndex(0);
                        }}
                      >
                        {visiblePairs.map((pair, index) => (
                          <option
                            key={pair.id}
                            value={pair.id}
                          >
                            Pair {index + 1}:{' '}
                            {pair.players.join(' / ')}
                          </option>
                        ))}
                      </select>

                    </label>

                    <span className="tag">
                      {pairScores(
                        scorePair.id,
                        state.scores
                      ).length}
                      /18 HOLES
                    </span>

                  </div>

                  <div className="hole-top">

                    <button
                      className="icon-button"
                      onClick={() =>
                        setHoleIndex(
                          Math.max(0, holeIndex - 1)
                        )
                      }
                    >
                      ‹
                    </button>

                    <div>

                      <span className="eyebrow">
                        HOLE {holeNumber} ·{' '}
                        {holeIndex + 1} OF 18 PLAYED
                      </span>

                      <h2>
                        Par {holeData.par}
                      </h2>

                      <p>
                        {holeData.yards} yards ·
                        Stroke index {holeData.si}
                      </p>

                    </div>

                    <button
                      className="icon-button"
                      onClick={() =>
                        setHoleIndex(
                          Math.min(17, holeIndex + 1)
                        )
                      }
                    >
                      ›
                    </button>

                  </div>

                  <div className="score-input">

                    <span>
                      Team gross strokes
                    </span>

                    <div>

                      <button
                        onClick={() =>
                          setStrokes(
                            Math.max(1, strokes - 1)
                          )
                        }
                      >
                        −
                      </button>

                      <strong>
                        {strokes}
                      </strong>

                      <button
                        onClick={() =>
                          setStrokes(
                            Math.min(20, strokes + 1)
                          )
                        }
                      >
                        +
                      </button>

                    </div>
                  </div>

                  <p className="field-label">
                    Whose selected drive?
                  </p>

                  <div className="drive-buttons">

                    {scorePair.players.map(player => (
                      <button
                        key={player}
                        className={
                          drive === player
                            ? 'chosen'
                            : ''
                        }
                        onClick={() =>
                          setDrive(player)
                        }
                      >
                        {drive === player && (
                          <Check size={16} />
                        )}

                        {player}
                      </button>
                    ))}

                  </div>

                  <label className="field-label">
                    Approved hole penalty strokes

                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={penalty}
                      onChange={event =>
                        setPenalty(
                          Math.max(
                            0,
                            Number(event.target.value)
                          )
                        )
                      }
                    />
                  </label>

                  <button
                    className="primary full"
                    disabled={!canEnterScores}
                    onClick={() =>
                      void saveCurrent()
                    }
                  >
                    <Save size={17} />
                    Save hole &amp; continue
                  </button>

                  <div className="drive-totals">

                    {driveCounts(
                      scorePair,
                      state.scores
                    ).map((count, index) => (
                      <span key={index}>
                        {scorePair.players[index]}
                        {' '}
                        <b>{count}/6</b> drives
                      </span>
                    ))}

                  </div>

                  <p className="fine-print">
                    Provisional scorecard. Official results
                    require verification by the players
                    and Director.

                    {pending.length > 0
                      ? ` ${pending.length} unsynced offline score(s).`
                      : ''}
                  </p>

                </div>

                <div className="hole-grid">

                  {scoreHoles.map((hole, index) => {
                    const recorded =
                      state.scores.find(
                        score =>
                          score.pairId === scorePair.id &&
                          score.hole === hole
                      );

                    return (
                      <button
                        key={hole}
                        className={
                          holeIndex === index
                            ? 'current'
                            : recorded
                              ? 'recorded'
                              : ''
                        }
                        onClick={() =>
                          setHoleIndex(index)
                        }
                      >
                        H{hole}

                        <b>
                          {recorded?.strokes ?? '—'}
                        </b>
                      </button>
                    );
                  })}

                </div>
              </>
            )}
          </>
        )}

        {/* LEADERBOARD */}

        {tab === 'leaderboard' && (
          <>
            {heading(
              'THE CHAMPIONSHIP',
              'Live Leaderboard',
              'Gross strokes, provisional net results and selected drive penalties.'
            )}

            {leaderboard.length === 0 ? (
              <div className="empty">

                <Medal size={38} />

                <h3>
                  Scores will appear here.
                </h3>

              </div>
            ) : (
              <div className="panel">

                <div className="responsive-table">

                  <table>

                    <thead>
                      <tr>
                        <th>POS</th>
                        <th>TEAM</th>
                        <th>THRU</th>
                        <th>GROSS</th>
                        <th>HCP</th>
                        <th>NET</th>
                        <th>STATUS</th>
                      </tr>
                    </thead>

                    <tbody>

                      {leaderboard.map((row, index) => (
                        <tr key={row.pair.id}>

                          <td className="gold">
                            {index + 1}
                          </td>

                          <td>
                            {row.pair.players.join(' & ')}
                          </td>

                          <td>
                            {row.holes}
                          </td>

                          <td>
                            {row.holes
                              ? row.gross
                              : '—'}
                          </td>

                          <td>
                            {row.pair.hcp?.toFixed(2) ?? 'TBC'}
                          </td>

                          <td>
                            {row.net?.toFixed(2) ?? '—'}
                          </td>

                          <td>
                            {row.done
                              ? 'Submitted'
                              : row.holes
                                ? 'Playing'
                                : 'Not started'}
                          </td>

                        </tr>
                      ))}

                    </tbody>
                  </table>

                </div>

                <p className="fine-print">
                  LIVE · PROVISIONAL.
                  Official results, ties and countback
                  need Director verification.
                </p>

              </div>
            )}
          </>
        )}

        {/* RULES */}

        {tab === 'rules' && (
          <>
            {heading(
              'OFFICIAL REGULATIONS',
              '2026 Playing Rules',
              'The seventh Christmas Eve Classic, 2-man Ambrose stroke play.'
            )}

            <div className="rule-grid">

              {[
                [
                  '01',
                  'Format',
                  'Both players tee off. Select the preferred ball and both play from that position until holed. One team gross score per hole.',
                ],
                [
                  '02',
                  'Six-drive minimum',
                  'Each golfer must contribute at least six selected tee shots. Two penalty strokes per missing drive.',
                ],
                [
                  '03',
                  'Handicap',
                  '35% of the lower playing handicap plus 15% of the higher. Confirm approved inputs and rounding.',
                ],
                [
                  '04',
                  'Preferred lies',
                  'Within one club length, no nearer the hole, in the same playing condition.',
                ],
                [
                  '05',
                  'Putting',
                  'Both players putt from the selected position. No gimmies.',
                ],
                [
                  '06',
                  'Countback',
                  'Back nine, back six, back three, final hole, then Director decision.',
                ],
                [
                  '07',
                  'Verification',
                  'Both golfers confirm their scorecard. The Director has final authority over results.',
                ],
              ].map(([number, title, body]) => (
                <div
                  className="panel rule"
                  key={number}
                >
                  <span className="eyebrow">
                    RULE {number}
                  </span>

                  <h3>{title}</h3>

                  <p>{body}</p>
                </div>
              ))}

            </div>
          </>
        )}

        {/* ACCOUNT AND TOURNAMENT DIRECTOR */}

        {tab === 'admin' && (
          <>
            {heading(
              'EVENT OPERATIONS',
              admin
                ? 'Tournament Director'
                : 'Your Account',
              admin
                ? 'Manage the draw, handicaps and live scoring.'
                : 'Select your name and sign in to your BBCDM player profile.'
            )}

            {cloudEnabled ? (
              <div className="panel">

                <h3>Account</h3>

                {role === 'guest' ? (
                  <>
                    <p>
                      Select your name and enter your
                      assigned four-digit BBCDM PIN.
                    </p>

                    <div className="login-row">

                      <select
                        aria-label="Select player"
                        value={loginPlayer}
                        onChange={event =>
                          setLoginPlayer(event.target.value)
                        }
                      >
                        {state.players.map(player => (
                          <option
                            key={player.name}
                            value={player.name}
                          >
                            {player.name}
                          </option>
                        ))}
                      </select>

                      <input
                        aria-label="Four-digit PIN"
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={4}
                        placeholder="4-digit PIN"
                        value={pin}
                        onChange={event =>
                          setPin(
                            event.target.value
                              .replace(/\D/g, '')
                              .slice(0, 4)
                          )
                        }
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            void signIn();
                          }
                        }}
                      />

                      <button
                        className="primary"
                        disabled={
                          loading ||
                          pin.length !== 4
                        }
                        onClick={() =>
                          void signIn()
                        }
                      >
                        <LogIn size={16} />

                        {loading
                          ? 'Checking...'
                          : 'Log in'}
                      </button>

                    </div>
                  </>
                ) : (
                  <div className="bar-row">

                    <p>
                      Signed in as{' '}
                      <b>
                        {role === 'director'
                          ? 'Tournament Director'
                          : role}
                      </b>
                    </p>

                    <button
                      onClick={() =>
                        void signOut()
                      }
                    >
                      Sign out
                    </button>

                  </div>
                )}

              </div>
            ) : (
              <div className="demo-note">

                <AlertTriangle size={18} />

                Local demo mode. Changes only
                appear on this device.

              </div>
            )}

            {/* STANDARD PLAYER ACCOUNT */}

            {signedIn && !admin && (
              <div className="panel">

                <h3>Player access</h3>

                <p>
                  You are signed in as {role}.
                  Open Scoring after the Director
                  starts the event.
                  Your assigned pair appears automatically.
                </p>

                <button
                  onClick={() => {
                    setSelected(role);
                    setTab('history');
                  }}
                >
                  My player profile
                </button>

              </div>
            )}

            {/* DIRECTOR-ONLY CONTROLS */}

            {admin && (
              <>

                {/* PAIR MANAGEMENT */}

                <div className="panel">

                  <div className="bar-row">

                    <div>
                      <span className="eyebrow">
                        THE DRAW
                      </span>

                      <h3>Pair management</h3>
                    </div>

                    <span className="tag">
                      {state.pairs.length} PAIRS
                    </span>

                  </div>

                  <p>
                    Randomise the field, review all
                    six groups and approve starting holes.
                    Saving a revised draw hides the draw
                    until you publish again.
                  </p>

                  <div className="btn-row">

                    <button
                      className="primary"
                      onClick={() =>
                        void generateDraw()
                      }
                    >
                      <Shuffle size={16} />
                      Generate pairs
                    </button>

                    <button
                      onClick={() =>
                        setTab('draw')
                      }
                    >
                      <ChevronRight size={16} />
                      Review assignments
                    </button>

                    <button
                      onClick={() =>
                        void saveDraw()
                      }
                    >
                      <Save size={16} />
                      Save assignments
                    </button>

                    <button
                      onClick={() =>
                        void publishDraw()
                      }
                    >
                      {state.published ? (
                        <Lock size={16} />
                      ) : (
                        <Unlock size={16} />
                      )}

                      {state.published
                        ? 'Hide draw'
                        : 'Publish draw'}
                    </button>

                  </div>

                </div>

                {/* EVENT STATUS */}

                <div className="panel">

                  <div className="bar-row">

                    <div>
                      <span className="eyebrow">
                        COMPETITION
                      </span>

                      <h3>Event status</h3>
                    </div>

                    <select
                      value={state.eventStatus}
                      onChange={event =>
                        void changeStatus(
                          event.target.value as
                            AppState['eventStatus']
                        )
                      }
                    >
                      <option value="registration">
                        Registration
                      </option>

                      <option value="draw">
                        Draw
                      </option>

                      <option value="live">
                        Live
                      </option>

                      <option value="final">
                        Final
                      </option>
                    </select>

                  </div>

                  <p className="fine-print">
                    To start Live, first save all 13 pairs,
                    publish the draw and approve all
                    player handicaps.
                  </p>

                </div>

                {/* HANDICAPS */}

                <div className="panel">

                  <span className="eyebrow">
                    HANDICAPS
                  </span>

                  <h3>
                    Approved player handicaps
                  </h3>

                  <p>
                    Enter values approved for the event.
                    Team handicap = 35% lower +
                    15% higher, rounded to two decimal places.
                  </p>

                  <div className="hcp-grid">

                    {state.players.map(player => (
                      <label key={player.name}>

                        {player.name}

                        <input
                          type="number"
                          step="0.1"
                          placeholder="TBC"
                          value={
                            hcpDrafts[player.name] ??
                            (player.handicap ?? '')
                          }
                          onChange={event =>
                            setHcpDrafts(old => ({
                              ...old,
                              [player.name]: event.target.value,
                            }))
                          }
                          onBlur={() =>
                            void commitHandicap(
                              player.name
                            )
                          }
                        />

                      </label>
                    ))}

                  </div>

                </div>

                {/* DAY-OF-COMPETITION CHECKLIST */}

                <div className="panel">

                  <span className="eyebrow">
                    DAY-OF-COMPETITION
                  </span>

                  <h3>Launch checklist</h3>

                  <p>
                    1. Approve handicaps.
                    2. Generate and save pairings.
                    3. Confirm group starting holes with Clare.
                    4. Publish the draw.
                    5. Change Event status to Live at 9:15 AM.
                    6. Players sign in and select Scoring.
                    7. Verify all scorecards before Final.
                  </p>

                  <p className="fine-print">
                    Do not change the draw after scoring begins.
                    Keep paper scorecards as a backup.
                  </p>

                </div>

              </>
            )}

          </>
        )}

      </main>

      {/* FOOTER */}

      <footer>

        <span>
          BBCDM GOLF · EST. 2020
        </span>

        <span>
          {cloudEnabled ? (
            <>
              <RefreshCw size={12} />
              CLOUD CONNECTED
            </>
          ) : (
            'PREVIEW MODE'
          )}

          {' '}· THE GOLD STANDARD
        </span>

      </footer>

    </div>
  );
}

// STATISTIC COMPONENT

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// HOME ACTION COMPONENT

function Action({
  title,
  sub,
  icon,
  onClick,
}: {
  title: string;
  sub: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="action"
      onClick={onClick}
    >
      <div className="action-icon">
        {icon}
      </div>

      <strong>{title}</strong>

      <p>{sub}</p>

      <ChevronRight
        size={18}
        className="action-arr"
      />
    </button>
  );
}

// PROGRESSIVE WEB APP

if (
  'serviceWorker' in navigator &&
  import.meta.env.PROD
) {
  navigator.serviceWorker
    .register('/sw.js')
    .catch(() => {});
}

// START APPLICATION

createRoot(
  document.getElementById('root')!
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
