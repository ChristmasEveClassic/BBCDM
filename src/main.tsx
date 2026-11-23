
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
  RotateCcw,
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
  Save
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
  supabase
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
  teamHandicap,
  venues
} from './engine';

import type { AppState, Score } from './types';

import './style.css';

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
  { id: 'admin', label: 'Admin', icon: LayoutDashboard }
];

const years = [2025, 2024, 2023, 2022, 2021, 2020];

function App() {
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

  const [selected, setSelected] = useState('Joshua Clarke');

  const [year, setYear] = useState(2025);

  const [role, setRole] = useState(
    cloudEnabled ? 'guest' : 'demo'
  );

  const [loginPlayer, setLoginPlayer] = useState(
    'Joshua Clarke'
  );

  const [pin, setPin] = useState('');

  const [message, setMessage] = useState('');

  const [loading, setLoading] = useState(false);

  const [online, setOnline] = useState(navigator.onLine);

  const [selectedPair, setSelectedPair] = useState('');

  const [holeIndex, setHoleIndex] = useState(0);

  const [strokes, setStrokes] = useState(4);

  const [drive, setDrive] = useState('');

  const [penalty, setPenalty] = useState(0);

  const [pending, setPending] = useState<Score[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem('bbcdm_pending') || '[]'
      );
    } catch {
      return [];
    }
  });

  // Tournament Director access is determined by Supabase.
  // The database must enforce the same permissions.

  const admin =
    role === 'director' ||
    (!cloudEnabled && role === 'demo');

  const canScore = role !== 'guest';

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

  // Supabase cloud connection and authentication.

  useEffect(() => {
    if (!supabase) return;

    let alive = true;

    const reload = async () => {
      try {
        const value = await getCloudState();

        if (alive) {
          setState(value);
        }

        const currentRole = await getRole();

        if (alive) {
          setRole(currentRole);
        }
      } catch (error) {
        if (alive) {
          setMessage(
            'Cloud connection issue: ' + String(error)
          );
        }
      }
    };

    void reload();

    const { data: listener } =
      supabase.auth.onAuthStateChange(() => {
        void reload();
      });

    const sub = supabase
      .channel('bbcdm-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public'
        },
        () => {
          void reload();
        }
      )
      .subscribe();

    return () => {
      alive = false;

      listener.subscription.unsubscribe();

      void supabase?.removeChannel(sub);
    };
  }, []);

  // Synchronise pending scores when connection returns.

  useEffect(() => {
    if (!online || !supabase || !pending.length) {
      return;
    }

    const sync = async () => {
      for (const score of pending) {
        try {
          await saveScore(score);

          setPending(current =>
            current.filter(
              item =>
                !(
                  item.pairId === score.pairId &&
                  item.hole === score.hole
                )
            )
          );
        } catch {
          return;
        }
      }

      try {
        setState(await getCloudState());
      } catch {
        // Retry when cloud connectivity resumes.
      }
    };

    void sync();
  }, [online, pending.length]);

  const leaderboard = useMemo(
    () => standings(state),
    [state]
  );

  const update = (next: AppState) => {
    setState(next);
  };

  const act = async (
    fn: () => Promise<void>,
    next: AppState
  ) => {
    update(next);

    try {
      await fn();
    } catch (error) {
      setMessage(
        'Update not saved to cloud: ' + String(error)
      );

      if (cloudEnabled) {
        try {
          setState(await getCloudState());
        } catch {
          // Preserve the error message for the user.
        }
      }
    }
  };

  // Player history.

  const selectedRecord = playerHistory(selected);

  const playerStats = stats(selected);

  // Players see their own scorecard.
  // Director access is unrestricted within the scoring interface.

  const availablePairs =
    admin || !cloudEnabled
      ? state.pairs
      : state.pairs.filter(pair =>
          pair.players.includes(role)
        );

  const scorePair =
    availablePairs.find(
      pair => pair.id === selectedPair
    ) || availablePairs[0];

  const scoreHoles = scorePair
    ? shotgunOrder(scorePair.startHole)
    : [];

  const holeNumber = scoreHoles[holeIndex] || 1;

  const holeData = course.find(
    hole => hole.hole === holeNumber
  )!;

  const currentRecord = scorePair
    ? state.scores.find(
        score =>
          score.pairId === scorePair.id &&
          score.hole === holeNumber
      )
    : undefined;

  useEffect(() => {
    if (currentRecord) {
      setStrokes(currentRecord.strokes);
      setDrive(currentRecord.drive);
      setPenalty(currentRecord.penalty);
    } else {
      setStrokes(holeData?.par || 4);
      setDrive('');
      setPenalty(0);
    }
  }, [
    selectedPair,
    holeIndex,
    state.pairs.length
  ]);

  // Save current hole score.

  const saveCurrent = async () => {
    if (!scorePair || !canScore) {
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
      updatedAt: new Date().toISOString()
    };

    setState(current => ({
      ...current,
      scores: [
        ...current.scores.filter(
          score =>
            !(
              score.pairId === entry.pairId &&
              score.hole === entry.hole
            )
        ),
        entry
      ]
    }));

    if (supabase) {
      try {
        if (!online) {
          throw new Error('offline');
        }

        await saveScore(entry);
      } catch {
        setPending(current => [
          ...current.filter(
            score =>
              !(
                score.pairId === entry.pairId &&
                score.hole === entry.hole
              )
          ),
          entry
        ]);

        setMessage(
          'Saved on this device. Pending sync when connected.'
        );
      }
    }

    setHoleIndex(current =>
      Math.min(17, current + 1)
    );
  };

  // Four-digit player PIN login.
  // The Edge Function verifies the PIN and returns a token.
  // Supabase exchanges the token for an authenticated session.

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
              pin
            }
          }
        );

      if (error || !data?.token_hash) {
        throw new Error(
          'Incorrect PIN or account temporarily locked.'
        );
      }

      const { error: sessionError } =
        await supabase.auth.verifyOtp({
          token_hash: data.token_hash,
          type: 'magiclink'
        });

      if (sessionError) {
        throw sessionError;
      }

      setPin('');
      setSelected(loginPlayer);
      setTab('history');

      setMessage(
        'Welcome, ' + loginPlayer
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Login failed.'
      );
    } finally {
      setLoading(false);
    }
  }

  // Player logout.

  async function signOut() {
    if (!supabase) {
      return;
    }

    const { error } =
      await supabase.auth.signOut();

    if (error) {
      setMessage(error.message);
      return;
    }

    setRole('guest');
    setPin('');
    setTab('home');
    setMessage('Signed out successfully.');
  }

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
            onClick={() => {
              setTab('admin');
              setMessage('');
            }}
            title="Account"
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
            Local preview. Connect Supabase to share
            registrations, pairings and scores across phones.
          </div>
        )}

        {!online && (
          <div className="offline">
            <WifiOff size={16} />
            Offline: scores are stored on this device
            until synced.
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
                value="26"
              />

              <Stat
                label="Ambrose pairs"
                value="13"
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
                sub="Pairings released by the committee."
                icon={<Shuffle />}
                onClick={() => setTab('draw')}
              />

              <Action
                title="Live Leaderboard"
                sub="Follow scores as the day unfolds."
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

        {/* FIELD */}

        {tab === 'field' && (
          <>
            {heading(
              'OFFICIAL 2026 FIELD',
              'The Competitors',
              '26 selected players. Historical records preloaded from the 2020–2025 archives.'
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

                    <strong>
                      {player.name}
                    </strong>

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
                  ...new Set(
                    results.flatMap(result => result.players)
                  )
                ]
                  .sort()
                  .map(player => (
                    <option key={player} value={player}>
                      {player}
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
                    {selectedRecord.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          No documented starts.
                        </td>
                      </tr>
                    ) : (
                      selectedRecord.map((record, index) => (
                        <tr
                          key={record.year + '-' + index}
                        >
                          <td>{record.year}</td>

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
                                title="Historical record pending verification"
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
                              .filter(
                                player => player !== selected
                              )
                              .join(', ') || 'Individual'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <p className="fine-print">
                † Placement or score requires historical
                verification. The 2022 competition used
                Stableford points. Other years used net strokes.
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
                    <option key={value} value={value}>
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
              'Every Christmas Eve Classic winner since 2020.'
            )}

            <div className="champ-grid">
              {years.map(value => {
                const winner = results.find(
                  record =>
                    record.year === value &&
                    record.position === '1st'
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
                      {winner?.score}{' '}
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

        {/* PAIRING DRAW */}

        {tab === 'draw' && (
          <>
            {heading(
              '2026 CHAMPIONSHIP',
              'The Draw',
              state.published
                ? 'The official pairs and shotgun assignments.'
                : 'Teams will be revealed by the Tournament Director.'
            )}

            {!state.published && !admin ? (
              <div className="empty">
                <Lock size={38} />

                <h3>
                  Pairings are under wraps.
                </h3>

                <p>
                  The official draw will appear here once published.
                </p>
              </div>
            ) : state.pairs.length === 0 ? (
              <div className="empty">
                <Shuffle size={38} />

                <h3>
                  No pairs assigned yet
                </h3>

                <p>
                  The Tournament Director will generate
                  the draw before play.
                </p>
              </div>
            ) : (
              <div className="pair-grid">
                {state.pairs.map((pair, index) => (
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
                        ...pair.players
                      ).join(', ') || 'None recorded'}
                    </small>

                    {admin && (
                      <div className="pair-tools">
                        <button
                          onClick={() =>
                            update({
                              ...state,
                              pairs: state.pairs.map(item =>
                                item.id === pair.id
                                  ? {
                                      ...item,
                                      locked: !item.locked
                                    }
                                  : item
                              )
                            })
                          }
                        >
                          {pair.locked ? (
                            <Unlock size={15} />
                          ) : (
                            <Lock size={15} />
                          )}

                          {pair.locked ? 'Unlock' : 'Lock'}
                        </button>

                        <label>
                          Group

                          <input
                            type="number"
                            min="1"
                            max="13"
                            value={pair.group}
                            onChange={event =>
                              update({
                                ...state,
                                pairs: state.pairs.map(item =>
                                  item.id === pair.id
                                    ? {
                                        ...item,
                                        group: Number(
                                          event.target.value
                                        )
                                      }
                                    : item
                                )
                              })
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
                              update({
                                ...state,
                                pairs: state.pairs.map(item =>
                                  item.id === pair.id
                                    ? {
                                        ...item,
                                        startHole: Number(
                                          event.target.value
                                        )
                                      }
                                    : item
                                )
                              })
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
              'Enter gross strokes and identify the selected tee shot on every hole.'
            )}

            {!canScore ? (
              <div className="empty">
                <Lock />

                <h3>
                  Sign in to record scores
                </h3>

                <button
                  className="primary"
                  onClick={() => setTab('admin')}
                >
                  Open sign in
                </button>
              </div>
            ) : !scorePair ? (
              <div className="empty">
                <ClipboardList size={38} />

                <h3>
                  No scorecard available
                </h3>

                <p>
                  Your scorecard will appear after the
                  draw is published and your account is
                  linked to your pair.
                </p>
              </div>
            ) : (
              <>
                <div className="panel score-panel">

                  <div className="bar-row">
                    <label className="field-label">
                      Choose pair

                      <select
                        value={scorePair.id}
                        onChange={event => {
                          setSelectedPair(
                            event.target.value
                          );

                          setHoleIndex(0);
                        }}
                      >
                        {availablePairs.map(
                          (pair, index) => (
                            <option
                              key={pair.id}
                              value={pair.id}
                            >
                              Pair {index + 1}:{' '}
                              {pair.players.join(' / ')}
                            </option>
                          )
                        )}
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
                    onClick={() =>
                      void saveCurrent()
                    }
                  >
                    <Save size={17} />
                    Save hole & continue
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
                    Scores remain provisional until both
                    players confirm and the committee
                    verifies the card.
                    {' '}
                    {pending.length > 0
                      ? `${pending.length} score(s) waiting for cloud sync.`
                      : ''}
                  </p>
                </div>

                <div className="hole-grid">
                  {scoreHoles.map(
                    (hole, index) => {
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
                            {recorded?.strokes || '—'}
                          </b>
                        </button>
                      );
                    }
                  )}
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
              'Gross strokes, net results and selected drive penalties.'
            )}

            {leaderboard.length === 0 ? (
              <div className="empty">
                <Medal size={38} />

                <h3>
                  Scores will appear here.
                </h3>

                <p>
                  Teams are yet to be drawn.
                </p>
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
                      {leaderboard.map(
                        (entry, index) => (
                          <tr key={entry.pair.id}>
                            <td className="gold">
                              {index + 1}
                            </td>

                            <td>
                              {entry.pair.players.join(' & ')}
                            </td>

                            <td>
                              {entry.holes}
                            </td>

                            <td>
                              {entry.holes
                                ? entry.gross
                                : '—'}
                            </td>

                            <td>
                              {entry.pair.hcp?.toFixed(2) ||
                                'TBC'}
                            </td>

                            <td>
                              {entry.net?.toFixed(2) || '—'}
                            </td>

                            <td>
                              {entry.done
                                ? 'Submitted'
                                : entry.holes
                                  ? 'Playing'
                                  : 'Not started'}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>

                <p className="fine-print">
                  LIVE · PROVISIONAL. Incomplete rounds
                  are ordered by gross strokes relative
                  to par played. Final net standings
                  require all 18 holes and approved
                  handicaps.
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
                  'Both players tee off. Select the preferred ball and both play from that position until holed. One gross team score per hole.'
                ],
                [
                  '02',
                  'Six-drive minimum',
                  'Each golfer must contribute at least six selected tee shots across the 18 holes. Two penalty strokes apply for each missing drive.'
                ],
                [
                  '03',
                  'Handicap',
                  '35% of the lower playing handicap plus 15% of the higher handicap. Input type and rounding are pending committee approval.'
                ],
                [
                  '04',
                  'Preferred lies',
                  'Within one club length, no nearer the hole, remaining in the same playing condition.'
                ],
                [
                  '05',
                  'Putting',
                  'Both players putt from the selected position. No gimmies.'
                ],
                [
                  '06',
                  'Countback',
                  'Back nine, back six, back three, final hole, then committee decision.'
                ],
                [
                  '07',
                  'Verification',
                  'Both golfers confirm the scorecard. The committee has final authority over disputes and official results.'
                ]
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
              'Administration',
              'Manage your account, player handicaps, team draw and competition status.'
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
                          setLoginPlayer(
                            event.target.value
                          )
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
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        aria-label="Four-digit PIN"
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
                          loading || pin.length !== 4
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
                Local demo mode. Admin actions are
                stored on this device only.
                No player data is shared until
                Supabase is configured.
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
                    Create random pairings, keep
                    locked pairs unchanged and
                    publish only when ready.
                  </p>

                  <div className="btn-row">
                    <button
                      className="primary"
                      onClick={() => {
                        const pairs = randomPairs(state);

                        void act(
                          () => savePairs(pairs),
                          {
                            ...state,
                            pairs,
                            published: false
                          }
                        );
                      }}
                    >
                      <Shuffle size={16} />
                      Generate pairs
                    </button>

                    <button
                      onClick={() =>
                        void act(
                          () => savePairs(state.pairs),
                          state
                        )
                      }
                    >
                      <Save size={16} />
                      Save assignments
                    </button>

                    <button
                      onClick={() =>
                        void act(
                          () =>
                            setPublish(
                              !state.published
                            ),
                          {
                            ...state,
                            published: !state.published
                          }
                        )
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

                  <p className="fine-print">
                    Adjust groups and starting holes
                    in The Draw screen, then click
                    Save assignments here. Team
                    handicaps calculate from
                    approved individual values.
                  </p>
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
                      onChange={event => {
                        const status =
                          event.target.value as
                            AppState['eventStatus'];

                        void act(
                          () => setStatus(status),
                          {
                            ...state,
                            eventStatus: status
                          }
                        );
                      }}
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
                </div>

                {/* PLAYER HANDICAPS */}

                <div className="panel">
                  <span className="eyebrow">
                    HANDICAPS
                  </span>

                  <h3>
                    Approved player handicaps
                  </h3>

                  <p>
                    Enter committee-approved
                    handicap values. The app uses
                    35% of the lower value and
                    15% of the higher value.
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
                            player.handicap ?? ''
                          }
                          onChange={event => {
                            const handicap =
                              event.target.value === ''
                                ? null
                                : Number(
                                    event.target.value
                                  );

                            const players =
                              state.players.map(item =>
                                item.name === player.name
                                  ? {
                                      ...item,
                                      handicap
                                    }
                                  : item
                              );

                            const pairs =
                              state.pairs.map(pair => ({
                                ...pair,
                                hcp: teamHandicap(
                                  players.find(
                                    item =>
                                      item.name ===
                                      pair.players[0]
                                  )?.handicap ?? null,

                                  players.find(
                                    item =>
                                      item.name ===
                                      pair.players[1]
                                  )?.handicap ?? null
                                )
                              }));

                            update({
                              ...state,
                              players,
                              pairs
                            });
                          }}
                          onBlur={event =>
                            void setPlayerHcp(
                              player.name,
                              event.target.value === ''
                                ? null
                                : Number(
                                    event.target.value
                                  )
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* OTHER ADMIN NOTES */}

                <div className="panel">
                  <span className="eyebrow">
                    IMPORTANT
                  </span>

                  <h3>
                    Next implementation steps
                  </h3>

                  <p>
                    For official live scoring,
                    assign approved player accounts
                    and marker permissions in
                    Supabase. Confirm handicap
                    input and rounding rules,
                    plus final shotgun allocations,
                    before play.
                  </p>

                  <button
                    onClick={() => {
                      setState(initial);

                      setMessage(
                        'Local preview reset. This does not delete cloud records.'
                      );
                    }}
                  >
                    <RotateCcw size={16} />
                    Reset local preview
                  </button>
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

// Statistic display component.

function Stat({
  label,
  value
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

// Home screen action component.

function Action({
  title,
  sub,
  icon,
  onClick
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

// Register the BBCDM Progressive Web App service worker.

if (
  'serviceWorker' in navigator &&
  import.meta.env.PROD
) {
  navigator.serviceWorker
    .register('/sw.js')
    .catch(() => {});
}

// Start the application.

createRoot(
  document.getElementById('root')!
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
