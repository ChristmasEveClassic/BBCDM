
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Flag, Users, Trophy, CalendarDays, BookOpen, ClipboardList, Shield, LogIn, ChevronRight, Check, Shuffle, Lock, Clock, MapPin, AlertTriangle, RefreshCw, WifiOff, UserRound, Medal, Save, Undo2, CheckCircle, BarChart3 } from 'lucide-react';
import { cloudEnabled, supabase, explain, getCloudState, getRole, getPreferences, savePreference, launchDraw, saveScore, deleteScore, getConfirmations, confirmRound, finaliseEvent, setPlayerHcp, signInWithPin, signOut } from './backend';
import { initial, results, founders, committee, venues, stats, playerHistory, ordinal, shotgunOrder } from './engine';
import { course2026, METRES_TOTAL, MIN_DRIVES } from './course2026';
import { makeDraw, pairMetrics, orderedLeaderboard, validationProblems, shotsFor } from './competition2026';
import type { AvoidVote, Confirmation } from './competition2026';
import type { AppState, Pair, Score, SelectedShot } from './types';
import './style.css';
import './upgrade.css';

type Tab = 'home' | 'field' | 'history' | 'champions' | 'draw' | 'scoring' | 'leaderboard' | 'rules' | 'admin';

const links: {
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
    { id: 'admin', label: 'Account', icon: UserRound }
];

const text = (error: unknown) => explain(error);

function App() {
    const [state, setState] = useState<AppState>(() => {
        try {
            return (JSON.parse(localStorage.getItem('bbcdm_demo_state') || 'null') || initial);
        }
        catch {
            return initial;
        }
    });

    const [role, setRole] = useState(cloudEnabled ? 'guest' : 'demo');
    const [tab, setTab] = useState<Tab>('home');
    const [loginName, setLoginName] = useState('Joshua Clarke');
    const [pin, setPin] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [online, setOnline] = useState(navigator.onLine);
    const [votes, setVotes] = useState<AvoidVote[]>([]);
    const [avoidOne, setAvoidOne] = useState('');
    const [avoidTwo, setAvoidTwo] = useState('');
    const [draft, setDraft] = useState<Pair[] | null>(null);
    const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
    const [playerViewed, setPlayerViewed] = useState('Joshua Clarke');
    const [historyYear, setHistoryYear] = useState(2025);
    const [pairId, setPairId] = useState('');
    const [holeIndex, setHoleIndex] = useState(0);
    const [selectedShots, setSelectedShots] = useState<SelectedShot[]>([]);
    const [penalty, setPenalty] = useState(0);
    const [shotKind, setShotKind] = useState<SelectedShot['kind']>('approach');
    const [lie, setLie] = useState<SelectedShot['lie']>('other');
    const [scoreDirty, setScoreDirty] = useState(false);
    const [editingShot, setEditingShot] = useState<number | null>(null);
    const loadedHoleKey = useRef('');
    const loadedVersion = useRef<number | null>(null);

    const [offlineQueue, setOfflineQueue] = useState<Score[]>(() => {
        try {
            return JSON.parse(localStorage.getItem('bbcdm_pending_shots') || '[]');
        }
        catch {
            return [];
        }
    });

    const [hcpDrafts, setHcpDrafts] = useState<Record<string, string>>({});
    const sequence = useRef(0);
    const queuedScores = useRef(offlineQueue);

    const draftStorage = useRef<Record<string, {
        shots: SelectedShot[];
        penalty: number;
    }>>((() => {
        try {
            return JSON.parse(localStorage.getItem('bbcdm_unsaved_holes_v2') || '{}');
        }
        catch {
            return {};
        }
    })());

    const director = role === 'director' || role === 'demo';
    const me = role === 'director' ? 'Joshua Clarke' : role;
    const loggedIn = role !== 'guest';
    const myVote = votes.find(vote => vote.player_name === me);
    const field = state.players.map(player => player.name);

    const visiblePairs = director
        ? state.pairs
        : state.pairs.filter(pair => pair.players.includes(me));

    const scorePair = visiblePairs.find(pair => pair.id === pairId) || visiblePairs[0];

    const scoreHoles = scorePair ? shotgunOrder(scorePair.startHole) : [];
    const hole = scoreHoles[holeIndex] || 1;
    const holeInfo = course2026[hole - 1];

    const existing = scorePair
        ? state.scores.find(score => score.pairId === scorePair.id && score.hole === hole)
        : undefined;

    const metrics = scorePair
        ? pairMetrics(scorePair, state.scores)
        : null;

    const leaderboard = useMemo(() => orderedLeaderboard(state), [state]);

    const refresh = useCallback(async () => {
        if (!cloudEnabled) return;

        const current = ++sequence.current;

        const [roleResult, stateResult, voteResult, confirmationResult] =
            await Promise.allSettled([
                getRole(),
                getCloudState(),
                getPreferences(),
                getConfirmations()
            ]);

        if (current !== sequence.current) return;

        if (roleResult.status === 'fulfilled') {
            setRole(roleResult.value);
        }
        else {
            setMessage('Account: ' + text(roleResult.reason));
        }

        if (stateResult.status === 'fulfilled') {
            const remote = stateResult.value;
            const pending = queuedScores.current;

            setState({
                ...remote,
                scores: [
                    ...remote.scores.filter(saved => !pending.some(
                        local => local.pairId === saved.pairId && local.hole === saved.hole
                    )),
                    ...pending
                ]
            });
        }
        else {
            setMessage('Tournament data: ' + text(stateResult.reason));
        }

        if (voteResult.status === 'fulfilled') {
            setVotes(voteResult.value);
        }

        if (confirmationResult.status === 'fulfilled') {
            setConfirmations(confirmationResult.value);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('bbcdm_demo_state', JSON.stringify(state));
    }, [state]);

    useEffect(() => {
        queuedScores.current = offlineQueue;
        localStorage.setItem('bbcdm_pending_shots', JSON.stringify(offlineQueue));
    }, [offlineQueue]);

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

    useEffect(() => {
        if (!supabase) return;

        void refresh();

        const { data: listener } = supabase.auth.onAuthStateChange(() => {
            window.setTimeout(() => {
                void refresh();
            }, 0);
        });

        const channel = supabase
            .channel('bbcdm-2026-live')
            .on('postgres_changes', {
                event: '*',
                schema: 'public'
            }, () => {
                void refresh();
            })
            .subscribe();

        const timer = window.setInterval(() => {
            if (navigator.onLine) {
                void refresh();
            }
        }, 20000);

        const focus = () => {
            if (!document.hidden) {
                void refresh();
            }
        };

        document.addEventListener('visibilitychange', focus);

        return () => {
            listener.subscription.unsubscribe();
            void supabase?.removeChannel(channel);
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', focus);
        };
    }, [refresh]);

    useEffect(() => {
        if (myVote) {
            setAvoidOne(myVote.avoid_one);
            setAvoidTwo(myVote.avoid_two);
        }
    }, [myVote?.avoid_one, myVote?.avoid_two]);

    useEffect(() => {
        const key = (scorePair?.id ?? '') + ':' + hole;
        const nextVersion = existing?.version ?? null;
        const movedHole = key !== loadedHoleKey.current;

        if (movedHole || (!scoreDirty && loadedVersion.current !== nextVersion)) {
            loadedHoleKey.current = key;
            loadedVersion.current = nextVersion;

            const recovered = draftStorage.current[key];

            setSelectedShots(
                recovered ? recovered.shots : existing ? shotsFor(existing) : []
            );
            setPenalty(recovered ? recovered.penalty : existing?.penalty ?? 0);
            setShotKind('approach');
            setLie('other');
            setScoreDirty(Boolean(recovered));
            setEditingShot(null);

            if (recovered) {
                setMessage('Recovered unsaved edits from this phone. Review before saving.');
            }
        }
    }, [scorePair?.id, hole, existing?.version, scoreDirty]);

    function persistUnsavedDraft(shots: SelectedShot[], pen: number) {
        if (!scorePair) return;

        const key = scorePair.id + ':' + hole;
        draftStorage.current[key] = { shots, penalty: pen };

        localStorage.setItem(
            'bbcdm_unsaved_holes_v2',
            JSON.stringify(draftStorage.current)
        );
    }

    function clearUnsavedDraft() {
        if (!scorePair) return;

        delete draftStorage.current[scorePair.id + ':' + hole];

        localStorage.setItem(
            'bbcdm_unsaved_holes_v2',
            JSON.stringify(draftStorage.current)
        );
    }

    function markScoreEdited(shots: SelectedShot[], pen: number) {
        persistUnsavedDraft(shots, pen);
        setScoreDirty(true);
        setMessage(
            'Unsaved changes are backed up on this phone. Save progress or Complete hole.'
        );
    }

    function discardScoreEdits() {
        clearUnsavedDraft();
        setSelectedShots(existing ? shotsFor(existing) : []);
        setPenalty(existing?.penalty ?? 0);
        setEditingShot(null);
        setScoreDirty(false);
    }

    function goToHole(index: number) {
        if (index < 0 || index >= scoreHoles.length || index === holeIndex) return;

        if (scoreDirty && !window.confirm(
            'Discard the unsaved changes on this hole?'
        )) return;

        if (scoreDirty) clearUnsavedDraft();

        setHoleIndex(index);
        setMessage('');
    }

    function changeRecordedShot(index: number, changes: Partial<SelectedShot>) {
        const next = selectedShots.map((shot, i) =>
            i === index ? { ...shot, ...changes } : shot
        );

        setSelectedShots(next);
        markScoreEdited(next, penalty);
    }

    async function reloadCurrentHole() {
        await run(async () => {
            if (!online) {
                throw Error('Connect to the internet to reload this hole.');
            }

            if (scoreDirty && !window.confirm(
                'Discard the unsaved changes on this hole?'
            )) return;

            if (offlineQueue.some(
                s => s.pairId === scorePair?.id && s.hole === hole
            )) {
                throw Error('This hole has an offline draft. Sync it before reloading.');
            }

            const latest = await getCloudState();
            clearUnsavedDraft();

            const latestHole = latest.scores.find(
                s => s.pairId === scorePair?.id && s.hole === hole
            );

            setState(latest);
            setSelectedShots(latestHole ? shotsFor(latestHole) : []);
            setPenalty(latestHole?.penalty ?? 0);
            setEditingShot(null);
            setScoreDirty(false);
            loadedVersion.current = latestHole?.version ?? null;

            setMessage('Loaded the latest saved hole from Supabase.');
        });
    }

    const run = async (action: () => Promise<void>) => {
        if (busy) return;

        setBusy(true);
        setMessage('');

        try {
            await action();
        }
        catch (error) {
            setMessage(text(error));
        }
        finally {
            setBusy(false);
        }
    };

    async function login() {
        await run(async () => {
            if (!loginName || pin.length !== 4) {
                throw Error('Select your name and enter four digits.');
            }

            await signInWithPin(loginName, pin);
            setPin('');
            setPlayerViewed(loginName);

            await refresh();

            const latest = await getCloudState();

            setTab(latest.published ? 'home' : 'field');
            setMessage('Signed in successfully.');
        });
    }

    async function logout() {
        await run(async () => {
            await signOut();
            setRole('guest');
            setTab('home');
            setMessage('Signed out.');
        });
    }

    async function vote() {
        await run(async () => {
            if (!loggedIn || (director && me !== 'Joshua Clarke')) {
                throw Error('Log in first.');
            }

            if (
                !avoidOne ||
                !avoidTwo ||
                avoidOne === avoidTwo ||
                avoidOne === me ||
                avoidTwo === me
            ) {
                throw Error('Choose two different players other than yourself.');
            }

            await savePreference(me, avoidOne, avoidTwo);
            await refresh();

            setMessage('Your two private preferences were saved.');
        });
    }

    async function previewDraw() {
        await run(async () => {
            const fresh = await getPreferences();
            setVotes(fresh);

            const pairs = makeDraw(state, fresh);
            setDraft(pairs);

            setMessage(
                'Draw created privately. Review each group, then publish and start live scoring.'
            );
        });
    }

    async function startNow() {
        await run(async () => {
            if (!draft) {
                throw Error('Generate a draw first.');
            }

            const problem = validationProblems(draft, field);
            if (problem) {
                throw Error(problem);
            }

            if (!window.confirm(
                'Publish all 13 pairs and open LIVE scoring immediately? This locks the draw.'
            )) return;

            await launchDraw(draft);
            setDraft(null);
            await refresh();

            setMessage('The official draw is published. Live scoring is ON.');
            setTab('draw');
        });
    }

    function modifyPair(id: string, changes: Partial<Pair>) {
        setDraft(old => old?.map(pair =>
            pair.id === id ? { ...pair, ...changes } : pair
        ) ?? null);
    }

    function updateGroupHole(group: number, startHole: number) {
        setDraft(old => old?.map(pair =>
            pair.group === group ? { ...pair, startHole } : pair
        ) ?? null);
    }

    function pendingLocal(score: Score) {
        const next = [
            ...queuedScores.current.filter(
                s => s.pairId !== score.pairId || s.hole !== score.hole
            ),
            score
        ];

        queuedScores.current = next;
        localStorage.setItem('bbcdm_pending_shots', JSON.stringify(next));
        setOfflineQueue(next);
    }

    async function writeHole(
        shots: SelectedShot[],
        done: boolean,
        pen: number,
        keepOnlyOnPhone = false
    ): Promise<'cloud' | 'offline'> {
        if (!scorePair || state.eventStatus !== 'live') {
            throw Error('Live scoring has not started.');
        }

        if (shots.length < 1 || shots.length > 20) {
            throw Error('Select between 1 and 20 strokes on this hole.');
        }

        if (!Number.isInteger(pen) || pen < 0 || pen > 20) {
            throw Error('Penalty strokes must be a whole number from 0 to 20.');
        }

        if (shots.some((s, index) =>
            !scorePair.players.includes(s.player) ||
            (index === 0 ? s.kind !== 'tee' : s.kind === 'tee')
        )) {
            throw Error('Check the selected player and shot type for every stroke.');
        }

        const pending = offlineQueue.find(
            s => s.pairId === scorePair.id && s.hole === hole
        );

        const entry: Score = {
            pairId: scorePair.id,
            hole,
            strokes: shots.length,
            drive: shots[0].player,
            shots: shots.map(shot => ({ ...shot })),
            penalty: pen,
            completed: done,
            version: pending?.version ?? existing?.version ?? 0,
            updatedAt: new Date().toISOString()
        };

        if (!online || !cloudEnabled || keepOnlyOnPhone) {
            pendingLocal(entry);

            setState(old => ({
                ...old,
                scores: [
                    ...old.scores.filter(
                        s => s.pairId !== entry.pairId || s.hole !== entry.hole
                    ),
                    entry
                ]
            }));

            setConfirmations(old =>
                old.filter(c => c.pair_id !== entry.pairId)
            );

            return 'offline';
        }

        const version = await saveScore(entry);
        entry.version = version;

        setConfirmations(old =>
            old.filter(c => c.pair_id !== entry.pairId)
        );

        setState(old => ({
            ...old,
            scores: [
                ...old.scores.filter(
                    s => s.pairId !== entry.pairId || s.hole !== entry.hole
                ),
                entry
            ]
        }));

        const remaining = queuedScores.current.filter(
            s => s.pairId !== entry.pairId || s.hole !== entry.hole
        );

        queuedScores.current = remaining;
        localStorage.setItem('bbcdm_pending_shots', JSON.stringify(remaining));
        setOfflineQueue(remaining);
        loadedVersion.current = version;

        return 'cloud';
    }

    function chooseShot(player: string) {
        if (busy || !scorePair) return;

        if (selectedShots.length >= 20) {
            setMessage(
                'Maximum 20 selected strokes per hole. Correct your score before continuing.'
            );
            return;
        }

        if (!scorePair.players.includes(player)) return;

        const shot: SelectedShot = {
            player,
            kind: selectedShots.length === 0 ? 'tee' : shotKind,
            lie
        };

        const next = [...selectedShots, shot];

        setSelectedShots(next);
        setEditingShot(null);
        markScoreEdited(next, penalty);

        if (lie === 'green') {
            setShotKind('putt');
        }
    }

    function changeTeeShot() {
        if (busy || !scorePair || !selectedShots.length) return;

        const other = scorePair.players.find(
            p => p !== selectedShots[0].player
        );

        if (!other) return;

        changeRecordedShot(0, { player: other });
    }

    function undoShot() {
        if (busy || selectedShots.length === 0) return;

        const next = selectedShots.slice(0, -1);

        setSelectedShots(next);
        setEditingShot(null);
        markScoreEdited(next, penalty);
    }

    function removeShot(index: number) {
        if (busy || index === 0) return;

        const next = selectedShots.filter((_, i) => i !== index);

        setSelectedShots(next);
        setEditingShot(null);
        markScoreEdited(next, penalty);
    }

    async function saveProgress() {
        await run(async () => {
            const location = await writeHole(selectedShots, false, penalty);

            clearUnsavedDraft();
            setScoreDirty(false);

            setMessage(location === 'cloud'
                ? `Hole ${hole} progress saved to Supabase. Finish the hole when the ball is holed.`
                : `Hole ${hole} saved on this phone only. Sync before confirming your round.`);
        });
    }

    async function resetSavedHole() {
        await run(async () => {
            if (!scorePair || !existing) return;

            if (!online) {
                throw Error('Connect to the internet to reset a saved hole.');
            }

            if (offlineQueue.some(
                s => s.pairId === scorePair.id && s.hole === hole
            )) {
                throw Error(
                    'This hole has an offline draft. Sync it before resetting the saved score.'
                );
            }

            if (!window.confirm(
                `DELETE the saved score for Hole ${hole}? This also cancels both scorecard confirmations. This cannot be undone.`
            )) return;

            await deleteScore(scorePair.id, hole, existing.version);

            clearUnsavedDraft();
            loadedVersion.current = null;
            setScoreDirty(false);
            setSelectedShots([]);
            setPenalty(0);
            setEditingShot(null);

            setState(old => ({
                ...old,
                scores: old.scores.filter(
                    s => s.pairId !== scorePair.id || s.hole !== hole
                )
            }));

            setConfirmations(old =>
                old.filter(c => c.pair_id !== scorePair.id)
            );

            setMessage(
                `Hole ${hole} was reset in Supabase. You may score it again.`
            );
        });
    }

    async function keepLocalBackup() {
        await run(async () => {
            await writeHole(selectedShots, false, penalty, true);

            clearUnsavedDraft();
            setScoreDirty(false);

            setMessage(
                `Hole ${hole} backed up ONLY on this phone. It is NOT submitted. Tap Sync offline holes when the connection works.`
            );
        });
    }

    async function finishHole() {
        await run(async () => {
            if (existing?.completed && !scoreDirty) {
                setMessage(
                    `Hole ${hole} is already completed. Edit a shot to change the score.`
                );
                return;
            }

            const location = await writeHole(selectedShots, true, penalty);

            clearUnsavedDraft();
            setScoreDirty(false);

            setMessage(location === 'cloud'
                ? `Hole ${hole} completed and saved to Supabase.`
                : `Hole ${hole} completed on this phone, not synced to Supabase.`);

            if (holeIndex < 17) {
                setHoleIndex(index => index + 1);
            }
        });
    }

    async function syncPending() {
        await run(async () => {
            if (!online) {
                throw Error('Internet connection required.');
            }

            for (const queued of offlineQueue) {
                try {
                    const version = await saveScore(queued);

                    setState(old => ({
                        ...old,
                        scores: old.scores.map(s =>
                            s.pairId === queued.pairId && s.hole === queued.hole
                                ? { ...s, version }
                                : s
                        )
                    }));

                    const remaining = queuedScores.current.filter(
                        score => score.pairId !== queued.pairId ||
                            score.hole !== queued.hole
                    );

                    queuedScores.current = remaining;

                    localStorage.setItem(
                        'bbcdm_pending_shots',
                        JSON.stringify(remaining)
                    );

                    setOfflineQueue(remaining);
                }
                catch (error) {
                    throw Error(
                        'Sync stopped on hole ' + queued.hole + '. ' +
                        text(error) + ' Your offline copy was kept.'
                    );
                }
            }

            await refresh();
            setMessage('All offline holes synced successfully.');
        });
    }

    async function confirm() {
        await run(async () => {
            if (!scorePair) {
                throw Error('No pair assigned.');
            }

            if (scoreDirty || offlineQueue.some(
                s => s.pairId === scorePair.id
            )) {
                throw Error(
                    'Save and sync all score changes before confirming your round.'
                );
            }

            await confirmRound(scorePair.id);
            await refresh();

            setMessage(
                'Your verification is recorded. Your partner must confirm too.'
            );
        });
    }

    async function finishEvent() {
        await run(async () => {
            if (!window.confirm(
                'Finalise the official tournament after both players confirm every card?'
            )) return;

            await finaliseEvent();
            await refresh();

            setMessage('The competition has been finalised.');
        });
    }

    async function changeHandicap(name: string) {
        await run(async () => {
            const raw = hcpDrafts[name];
            if (raw === undefined) return;

            const handicap = raw.trim() === '' ? null : Number(raw);

            if (handicap !== null && (
                !Number.isFinite(handicap) ||
                handicap < -10 ||
                handicap > 60
            )) {
                throw Error('Invalid handicap.');
            }

            await setPlayerHcp(name, handicap);

            setHcpDrafts(old => {
                const next = { ...old };
                delete next[name];
                return next;
            });

            await refresh();
            setMessage(name + ' handicap saved.');
        });
    }

    const heading = (eyebrow: string, title: string, desc?: string) => (
        <div className="page-heading">
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
            {desc && <p>{desc}</p>}
        </div>
    );

    const pairForMe = state.pairs.find(pair =>
        pair.players.includes(me)
    );

    const confirmed = scorePair
        ? confirmations.filter(c => c.pair_id === scorePair.id)
        : [];

    const myConfirmed = confirmed.some(c => c.player_name === me);

    return (
        <div className="app-shell">
            <header className="top">
                <div
                    className="brand"
                    onClick={() => {
                        if (tab === 'scoring' && scoreDirty) {
                            if (!window.confirm(
                                'Leave scoring and discard unsaved changes?'
                            )) return;
                            discardScoreEdits();
                        }
                        setTab('home');
                    }}
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
                    <span className="edition">THE GOLD STANDARD · VII</span>
                    <button
                        className="icon-button"
                        onClick={() => setTab('admin')}
                        title="Account"
                    >
                        <UserRound size={19} />
                    </button>
                </div>
            </header>

            <nav className="nav">
                {links.map(section => (
                    <button
                        key={section.id}
                        className={tab === section.id ? 'active' : ''}
                        onClick={() => {
                            if (
                                tab === 'scoring' &&
                                section.id !== 'scoring' &&
                                scoreDirty &&
                                !window.confirm(
                                    'Leave scoring and discard unsaved changes?'
                                )
                            ) return;

                            if (
                                tab === 'scoring' &&
                                section.id !== 'scoring' &&
                                scoreDirty
                            ) {
                                discardScoreEdits();
                            }

                            setTab(section.id);
                            setMessage('');
                        }}
                    >
                        <section.icon size={17} />
                        <span>
                            {section.id === 'admin' && director
                                ? 'Director'
                                : section.label}
                        </span>
                    </button>
                ))}
            </nav>

            <main>
                {!cloudEnabled && (
                    <div className="demo-bar">
                        <AlertTriangle size={16} />
                        Cloud connection missing. Live features require Supabase.
                    </div>
                )}

                {!online && (
                    <div className="offline">
                        <WifiOff size={16} />
                        Offline. Scores are private drafts until they sync.
                    </div>
                )}

                {message && (
                    <div className="notice" role="status">
                        <span>{message}</span>
                        <button
                            className="dismiss"
                            onClick={() => setMessage('')}
                        >
                            ×
                        </button>
                    </div>
                )}

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
                                Thursday 24 December · Clare Golf Club ·
                                9:15 AM shotgun
                            </p>

                            <div className="hero-meta">
                                <span>
                                    <MapPin size={16} />
                                    Men's white tees
                                </span>
                                <span>
                                    <Flag size={16} />
                                    {METRES_TOTAL.toLocaleString()} metres
                                </span>
                                <span>
                                    <CalendarDays size={16} />
                                    Par 72
                                </span>
                            </div>
                        </section>

                        <div className="stats-grid">
                            <Stat label="Players" value={state.players.length} />
                            <Stat label="Pairs" value={state.pairs.length || 13} />
                            <Stat label="Voting" value={`${votes.length}/26`} />
                            <Stat
                                label="Status"
                                value={state.eventStatus.toUpperCase()}
                            />
                        </div>

                        {loggedIn && pairForMe && state.published && (
                            <div className="panel my-pair">
                                <span className="eyebrow">
                                    YOUR OFFICIAL PAIR
                                </span>

                                <h3>{pairForMe.players.join(' & ')}</h3>

                                <p>
                                    Group {pairForMe.group} ·
                                    Start hole {pairForMe.startHole} ·
                                    HCP {pairForMe.hcp?.toFixed(2) ?? 'TBC'}
                                </p>

                                <button
                                    className="primary"
                                    onClick={() => setTab('scoring')}
                                >
                                    Open scorecard
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        )}

                        <div className="action-grid">
                            <Action
                                title="Player preferences"
                                sub="Choose your two exclusions before the draw."
                                icon={<Users />}
                                onClick={() => setTab('field')}
                            />
                            <Action
                                title="Official draw"
                                sub="Partners, groups and starting holes."
                                icon={<Shuffle />}
                                onClick={() => setTab('draw')}
                            />
                            <Action
                                title="Live leaderboard"
                                sub="Gross, net and shot contributions."
                                icon={<Medal />}
                                onClick={() => setTab('leaderboard')}
                            />
                        </div>
                    </>
                )}

                {tab === 'field' && (
                    <>
                        {heading(
                            '2026 FIELD',
                            'Player preferences',
                            'Privately choose two competitors you would rather not have as your Ambrose partner.'
                        )}

                        {state.eventStatus === 'registration' && (
                            <div className="panel vote-panel">
                                <h3>My pairing preferences</h3>

                                {!loggedIn ? (
                                    <>
                                        <p>
                                            Sign in using your four-digit PIN
                                            before choosing your preferences.
                                        </p>

                                        <button
                                            className="primary"
                                            onClick={() => setTab('admin')}
                                        >
                                            Log in
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p>
                                            Only you and the Tournament Director
                                            see your choices. Both selections
                                            are treated as firm exclusions.
                                        </p>

                                        <div className="vote-grid">
                                            <label>
                                                First player to avoid
                                                <select
                                                    value={avoidOne}
                                                    onChange={event =>
                                                        setAvoidOne(event.target.value)
                                                    }
                                                >
                                                    <option value="">
                                                        Select player
                                                    </option>

                                                    {field
                                                        .filter(name =>
                                                            name !== me &&
                                                            name !== avoidTwo
                                                        )
                                                        .map(name => (
                                                            <option key={name}>
                                                                {name}
                                                            </option>
                                                        ))}
                                                </select>
                                            </label>

                                            <label>
                                                Second player to avoid
                                                <select
                                                    value={avoidTwo}
                                                    onChange={event =>
                                                        setAvoidTwo(event.target.value)
                                                    }
                                                >
                                                    <option value="">
                                                        Select player
                                                    </option>

                                                    {field
                                                        .filter(name =>
                                                            name !== me &&
                                                            name !== avoidOne
                                                        )
                                                        .map(name => (
                                                            <option key={name}>
                                                                {name}
                                                            </option>
                                                        ))}
                                                </select>
                                            </label>
                                        </div>

                                        <button
                                            className="primary"
                                            disabled={busy || !avoidOne || !avoidTwo}
                                            onClick={() => void vote()}
                                        >
                                            <Save size={16} />
                                            {myVote
                                                ? 'Update my choices'
                                                : 'Save my choices'}
                                        </button>

                                        {myVote && (
                                            <p className="success-text">
                                                <Check size={16} />
                                                Preferences recorded.
                                                You may change them until the draw closes.
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {state.eventStatus !== 'registration' && (
                            <div className="panel">
                                <CheckCircle size={20} />
                                <p>
                                    Preferences are closed.
                                    View your published pairing in The Draw.
                                </p>
                            </div>
                        )}

                        <div className="field-grid">
                            {state.players.map((player, index) => {
                                const record = stats(player.name);

                                return (
                                    <button
                                        key={player.name}
                                        className="player-card"
                                        onClick={() => {
                                            setPlayerViewed(player.name);
                                            setTab('history');
                                        }}
                                    >
                                        <span className="player-no">
                                            {String(index + 1).padStart(2, '0')}
                                        </span>

                                        <strong>{player.name}</strong>

                                        <div className="player-stat">
                                            HCP {player.handicap ?? 'TBC'} ·
                                            {record.starts} starts ·
                                            {record.titles} titles
                                        </div>

                                        {founders.includes(player.name) && (
                                            <span className="mini-badge">
                                                FOUNDING MEMBER
                                            </span>
                                        )}

                                        <ChevronRight
                                            size={16}
                                            className="arrow"
                                        />
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}

                {tab === 'history' && (
                    <>
                        {heading(
                            'THE BBCDM ARCHIVE',
                            'Player History',
                            'Every documented result, finishing position and partnership.'
                        )}

                        <div className="panel profile">
                            <select
                                value={playerViewed}
                                onChange={event =>
                                    setPlayerViewed(event.target.value)
                                }
                            >
                                {[
                                    ...new Set([
                                        ...field,
                                        ...results.flatMap(
                                            result => result.players
                                        )
                                    ])
                                ].sort().map(name => (
                                    <option key={name}>{name}</option>
                                ))}
                            </select>

                            <h3>{playerViewed}</h3>

                            <div className="profile-badges">
                                {founders.includes(playerViewed) && (
                                    <span className="tag">
                                        FOUNDING MEMBER
                                    </span>
                                )}

                                {committee[playerViewed] && (
                                    <span className="tag">
                                        {committee[playerViewed]}
                                    </span>
                                )}
                            </div>

                            <div className="stats-grid">
                                <Stat
                                    label="Starts"
                                    value={stats(playerViewed).starts}
                                />
                                <Stat
                                    label="Titles"
                                    value={stats(playerViewed).titles}
                                />
                                <Stat
                                    label="Best finish"
                                    value={stats(playerViewed).best || '—'}
                                />
                                <Stat
                                    label="Debut"
                                    value={stats(playerViewed).debut || '—'}
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
                                        {playerHistory(playerViewed).map(
                                            (result, index) => (
                                                <tr
                                                    key={result.year + '-' + index}
                                                >
                                                    <td>{result.year}</td>
                                                    <td>
                                                        {ordinal(result.position)}
                                                    </td>
                                                    <td>
                                                        {result.score ?? '—'}
                                                    </td>
                                                    <td>
                                                        {result.players
                                                            .filter(name =>
                                                                name !== playerViewed
                                                            )
                                                            .join(', ') ||
                                                            'Individual'}
                                                    </td>
                                                </tr>
                                            )
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="panel archive">
                            <div className="bar-row">
                                <h3>Historical tournaments</h3>

                                <select
                                    value={historyYear}
                                    onChange={event =>
                                        setHistoryYear(Number(event.target.value))
                                    }
                                >
                                    {[2025, 2024, 2023, 2022, 2021, 2020]
                                        .map(year => (
                                            <option key={year}>
                                                {year}
                                            </option>
                                        ))}
                                </select>
                            </div>

                            <p>
                                {venues[String(historyYear)]?.[0]} ·
                                {venues[String(historyYear)]?.[1]}
                            </p>

                            <div className="responsive-table">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Finish</th>
                                            <th>Players</th>
                                            <th>Score</th>
                                        </tr>
                                    </thead>

                                    <tbody>
                                        {results
                                            .filter(result =>
                                                result.year === historyYear
                                            )
                                            .map((result, index) => (
                                                <tr key={index}>
                                                    <td>
                                                        {ordinal(result.position)}
                                                    </td>
                                                    <td>
                                                        {result.players.join(' & ')}
                                                    </td>
                                                    <td>
                                                        {result.score ?? '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'champions' && (
                    <>
                        {heading(
                            'THE HONOUR BOARD',
                            'Champions',
                            'Official historical winners, 2020 to 2025.'
                        )}

                        <div className="champ-grid">
                            {[2025, 2024, 2023, 2022, 2021, 2020]
                                .map(year => {
                                    const winner = results.find(result =>
                                        result.year === year &&
                                        result.position === '1st'
                                    );

                                    return (
                                        <div className="champ" key={year}>
                                            <span>
                                                {year} ·
                                                {venues[String(year)]?.[0]}
                                            </span>

                                            <Trophy
                                                size={24}
                                                color="#b8933a"
                                            />

                                            <h3>
                                                {winner?.players.join(' & ')}
                                            </h3>

                                            <p>
                                                {winner?.score ?? 'Pending'}{' '}
                                                {year === 2022
                                                    ? 'Stableford points'
                                                    : 'net strokes'}
                                            </p>
                                        </div>
                                    );
                                })}
                        </div>
                    </>
                )}

                {tab === 'draw' && (
                    <>
                        {heading(
                            'THE CHAMPIONSHIP',
                            'The Draw',
                            state.published
                                ? 'Official playing partners, groups and shotgun holes.'
                                : 'The draw will appear once the Director publishes and starts the event.'
                        )}

                        {director && state.eventStatus === 'registration' && (
                            <div className="panel">
                                <h3>Director: generate and launch</h3>

                                <p>
                                    {votes.length}/26 preference forms received.
                                    All 26 must submit before generating
                                    the official draw.
                                    No unwanted partnership will be forced.
                                </p>

                                <div className="btn-row">
                                    <button
                                        className="primary"
                                        disabled={busy || votes.length !== 26}
                                        onClick={() => void previewDraw()}
                                    >
                                        <Shuffle size={16} />
                                        Generate draw preview
                                    </button>

                                    {draft && (
                                        <button
                                            disabled={busy}
                                            onClick={() => void startNow()}
                                        >
                                            <Flag size={16} />
                                            Publish & start live scoring
                                        </button>
                                    )}
                                </div>

                                {draft && (
                                    <p className="fine-print">
                                        Preview only. Adjust groups and
                                        starting holes below.
                                        Publishing starts live scoring immediately.
                                    </p>
                                )}

                                {votes.length < 26 && (
                                    <div className="fine-print">
                                        Waiting for:{' '}
                                        {field
                                            .filter(name =>
                                                !votes.some(vote =>
                                                    vote.player_name === name
                                                )
                                            )
                                            .join(', ')}
                                    </div>
                                )}
                            </div>
                        )}

                        {!state.published && !director && !draft ? (
                            <div className="empty">
                                <Lock size={38} />
                                <h3>The draw is not published yet.</h3>
                            </div>
                        ) : (draft ?? state.pairs).length === 0 ? (
                            <div className="empty">
                                <Shuffle size={38} />
                                <h3>No pairs assigned.</h3>
                            </div>
                        ) : (
                            <div className="pair-grid">
                                {(draft ?? state.pairs).map((pair, index) => (
                                    <div className="pair-card" key={pair.id}>
                                        <div className="bar-row">
                                            <span className="eyebrow">
                                                PAIR {String(index + 1)
                                                    .padStart(2, '0')}
                                            </span>

                                            <span className="tag">
                                                GROUP {pair.group}
                                            </span>
                                        </div>

                                        <h3>
                                            {pair.players.join(' & ')}
                                        </h3>

                                        <p>
                                            Hole {pair.startHole} ·
                                            HCP {pair.hcp?.toFixed(2) ?? 'TBC'}
                                        </p>

                                        {draft && director && (
                                            <div className="pair-tools">
                                                <label>
                                                    Group
                                                    <select
                                                        value={pair.group}
                                                        onChange={event =>
                                                            modifyPair(
                                                                pair.id,
                                                                {
                                                                    group:
                                                                        Number(
                                                                            event.target.value
                                                                        )
                                                                }
                                                            )
                                                        }
                                                    >
                                                        {[1, 2, 3, 4, 5, 6]
                                                            .map(n => (
                                                                <option key={n}>
                                                                    {n}
                                                                </option>
                                                            ))}
                                                    </select>
                                                </label>

                                                <label>
                                                    Starting hole
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="18"
                                                        value={pair.startHole}
                                                        onChange={event =>
                                                            updateGroupHole(
                                                                pair.group,
                                                                Number(
                                                                    event.target.value
                                                                )
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

                {tab === 'scoring' && (
                    <>
                        {heading(
                            'LIVE · ON COURSE',
                            'Shot-by-shot scoring',
                            'Select the ball used after every stroke. The first selected shot is the tee shot.'
                        )}

                        {!loggedIn ? (
                            <div className="empty">
                                <Lock size={38} />
                                <h3>Sign in to score.</h3>

                                <button
                                    className="primary"
                                    onClick={() => setTab('admin')}
                                >
                                    Log in
                                </button>
                            </div>
                        ) : state.eventStatus !== 'live' ? (
                            <div className="empty">
                                <Clock size={38} />
                                <h3>Live scoring is not open yet.</h3>
                                <p>
                                    The Director starts scoring as soon as
                                    the official draw is published.
                                </p>
                            </div>
                        ) : !scorePair ? (
                            <div className="empty">
                                <ClipboardList size={38} />
                                <h3>No scorecard assigned.</h3>
                            </div>
                        ) : (
                            <>
                                <div className="panel score-panel">
                                    <div className="bar-row">
                                        <label className="field-label">
                                            Playing pair

                                            <select
                                                value={scorePair.id}
                                                onChange={event => {
                                                    if (
                                                        scoreDirty &&
                                                        !window.confirm(
                                                            'Discard unsaved changes before switching pairs?'
                                                        )
                                                    ) return;

                                                    if (scoreDirty) {
                                                        clearUnsavedDraft();
                                                    }

                                                    setPairId(event.target.value);
                                                    setHoleIndex(0);
                                                }}
                                            >
                                                {visiblePairs.map(pair => (
                                                    <option
                                                        key={pair.id}
                                                        value={pair.id}
                                                    >
                                                        {pair.players.join(' & ')}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>

                                        <span className="tag">
                                            {metrics?.holes}/18 FINISHED
                                        </span>
                                    </div>

                                    <div className="hole-top">
                                        <button
                                            className="icon-button"
                                            onClick={() =>
                                                goToHole(holeIndex - 1)
                                            }
                                        >
                                            ‹
                                        </button>

                                        <div>
                                            <span className="eyebrow">
                                                HOLE {hole} ·
                                                {holeIndex + 1} OF 18
                                                IN SHOTGUN ORDER
                                            </span>

                                            <h2>
                                                Par {holeInfo.par}
                                            </h2>

                                            <p>
                                                {holeInfo.metres} m ·
                                                Stroke index {holeInfo.si}
                                            </p>
                                        </div>

                                        <button
                                            className="icon-button"
                                            onClick={() =>
                                                goToHole(holeIndex + 1)
                                            }
                                        >
                                            ›
                                        </button>
                                    </div>

                                    <div className="score-counter">
                                        <div>
                                            <span>Selected strokes</span>
                                            <strong>
                                                {selectedShots.length}
                                            </strong>
                                        </div>

                                        <div>
                                            <span>Penalty strokes</span>

                                            <input
                                                type="number"
                                                min="0"
                                                max="20"
                                                value={penalty}
                                                onChange={event => {
                                                    const next = Math.max(
                                                        0,
                                                        Math.min(
                                                            20,
                                                            Number(event.target.value) || 0
                                                        )
                                                    );

                                                    setPenalty(next);
                                                    markScoreEdited(
                                                        selectedShots,
                                                        next
                                                    );
                                                }}
                                            />
                                        </div>
                                    </div>

                                    <h3>
                                        Shot {selectedShots.length + 1}:{' '}
                                        {selectedShots.length === 0
                                            ? 'Tee shot'
                                            : 'Select the ball used'}
                                    </h3>

                                    {selectedShots.length > 0 && (
                                        <div className="shot-options">
                                            <label>
                                                Shot type
                                                <select
                                                    value={shotKind}
                                                    onChange={event =>
                                                        setShotKind(
                                                            event.target.value as
                                                            SelectedShot['kind']
                                                        )
                                                    }
                                                >
                                                    <option value="approach">
                                                        Approach
                                                    </option>
                                                    <option value="chip">
                                                        Chip
                                                    </option>
                                                    <option value="putt">
                                                        Putt
                                                    </option>
                                                    <option value="recovery">
                                                        Recovery
                                                    </option>
                                                </select>
                                            </label>
                                        </div>
                                    )}

                                    <div className="shot-options">
                                        <label>
                                            Where did the selected ball finish?

                                            <select
                                                value={lie}
                                                onChange={event =>
                                                    setLie(
                                                        event.target.value as
                                                        SelectedShot['lie']
                                                    )
                                                }
                                            >
                                                <option value="other">
                                                    Not recorded
                                                </option>
                                                <option value="fairway">
                                                    Fairway
                                                </option>
                                                <option value="rough">
                                                    Rough
                                                </option>
                                                <option value="bunker">
                                                    Bunker
                                                </option>
                                                <option value="green">
                                                    Green
                                                </option>
                                                <option value="hazard">
                                                    Hazard
                                                </option>
                                            </select>
                                        </label>
                                    </div>

                                    <div className="choose-shot">
                                        {scorePair.players.map(player => (
                                            <button
                                                type="button"
                                                className="score-player"
                                                disabled={busy}
                                                key={player}
                                                onClick={() =>
                                                    chooseShot(player)
                                                }
                                            >
                                                <span className="score-player-plus">
                                                    +
                                                </span>
                                                <span>{player}</span>
                                                <small>
                                                    Use this player's ball
                                                </small>
                                            </button>
                                        ))}
                                    </div>

                                    <div
                                        className="score-save-state"
                                        role="status"
                                    >
                                        {scoreDirty
                                            ? 'Unsaved changes on this hole. Tap Save progress or Complete hole.'
                                            : offlineQueue.some(
                                                s => s.pairId === scorePair.id &&
                                                    s.hole === hole
                                            )
                                                ? 'Saved on this phone only. Use Sync offline holes when connected.'
                                                : existing
                                                    ? `Saved in Supabase · ${existing.completed
                                                        ? 'Hole completed'
                                                        : 'Hole in progress'}`
                                                    : 'No score saved for this hole yet.'}

                                        <span>
                                            Team total:{' '}
                                            {selectedShots.length + penalty}{' '}
                                            strokes, including {penalty} penalty.
                                        </span>
                                    </div>

                                    <div className="shot-history">
                                        <h4>
                                            Selected shots on this hole
                                        </h4>

                                        {selectedShots.length === 0 ? (
                                            <p>
                                                Tap the player whose tee shot
                                                you selected. Each tap records
                                                one stroke in your local draft.
                                            </p>
                                        ) : selectedShots.map(
                                            (shot, index) => (
                                                <div
                                                    className="shot-editor"
                                                    key={index}
                                                >
                                                    <div className="shot-record">
                                                        <span>
                                                            {index + 1}.{' '}
                                                            {shot.kind === 'tee'
                                                                ? 'Tee shot'
                                                                : shot.kind}
                                                        </span>

                                                        <strong>
                                                            {shot.player}
                                                        </strong>

                                                        <button
                                                            type="button"
                                                            className="edit-shot-button"
                                                            disabled={busy}
                                                            onClick={() =>
                                                                setEditingShot(
                                                                    editingShot === index
                                                                        ? null
                                                                        : index
                                                                )
                                                            }
                                                        >
                                                            {editingShot === index
                                                                ? 'Close'
                                                                : 'Edit'}
                                                        </button>
                                                    </div>

                                                    {editingShot === index && (
                                                        <div className="shot-edit-fields">
                                                            <label>
                                                                Selected player
                                                                <select
                                                                    aria-label={
                                                                        `Player for shot ${index + 1}`
                                                                    }
                                                                    disabled={busy}
                                                                    value={shot.player}
                                                                    onChange={e =>
                                                                        changeRecordedShot(
                                                                            index,
                                                                            {
                                                                                player:
                                                                                    e.target.value
                                                                            }
                                                                        )
                                                                    }
                                                                >
                                                                    {scorePair.players.map(
                                                                        name => (
                                                                            <option
                                                                                key={name}
                                                                                value={name}
                                                                            >
                                                                                {name}
                                                                            </option>
                                                                        )
                                                                    )}
                                                                </select>
                                                            </label>

                                                            {index > 0 && (
                                                                <label>
                                                                    Shot type
                                                                    <select
                                                                        aria-label={
                                                                            `Type for shot ${index + 1}`
                                                                        }
                                                                        disabled={busy}
                                                                        value={shot.kind}
                                                                        onChange={e =>
                                                                            changeRecordedShot(
                                                                                index,
                                                                                {
                                                                                    kind:
                                                                                        e.target.value as
                                                                                        SelectedShot['kind']
                                                                                }
                                                                            )
                                                                        }
                                                                    >
                                                                        <option value="approach">
                                                                            Approach
                                                                        </option>
                                                                        <option value="chip">
                                                                            Chip
                                                                        </option>
                                                                        <option value="putt">
                                                                            Putt
                                                                        </option>
                                                                        <option value="recovery">
                                                                            Recovery
                                                                        </option>
                                                                    </select>
                                                                </label>
                                                            )}

                                                            <label>
                                                                Ball finished
                                                                <select
                                                                    aria-label={
                                                                        `Lie for shot ${index + 1}`
                                                                    }
                                                                    disabled={busy}
                                                                    value={shot.lie ?? 'other'}
                                                                    onChange={e =>
                                                                        changeRecordedShot(
                                                                            index,
                                                                            {
                                                                                lie:
                                                                                    e.target.value as
                                                                                    SelectedShot['lie']
                                                                            }
                                                                        )
                                                                    }
                                                                >
                                                                    <option value="other">
                                                                        Not recorded
                                                                    </option>
                                                                    <option value="fairway">
                                                                        Fairway
                                                                    </option>
                                                                    <option value="rough">
                                                                        Rough
                                                                    </option>
                                                                    <option value="bunker">
                                                                        Bunker
                                                                    </option>
                                                                    <option value="green">
                                                                        Green
                                                                    </option>
                                                                    <option value="hazard">
                                                                        Hazard
                                                                    </option>
                                                                </select>
                                                            </label>

                                                            {index > 0 && (
                                                                <button
                                                                    type="button"
                                                                    disabled={busy}
                                                                    onClick={() =>
                                                                        removeShot(index)
                                                                    }
                                                                >
                                                                    Remove this stroke
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        )}
                                    </div>

                                    <div className="btn-row score-actions">
                                        <button
                                            type="button"
                                            disabled={busy || selectedShots.length === 0}
                                            onClick={changeTeeShot}
                                        >
                                            Change tee shot
                                        </button>

                                        <button
                                            type="button"
                                            disabled={busy || selectedShots.length === 0}
                                            onClick={undoShot}
                                        >
                                            <Undo2 size={16} />
                                            Undo last stroke
                                        </button>

                                        <button
                                            type="button"
                                            disabled={busy || !online || !cloudEnabled}
                                            onClick={() =>
                                                void reloadCurrentHole()
                                            }
                                        >
                                            <RefreshCw size={16} />
                                            Reload saved hole
                                        </button>

                                        {existing && (
                                            <button
                                                type="button"
                                                className="score-reset-button"
                                                disabled={busy || !online || !cloudEnabled}
                                                onClick={() =>
                                                    void resetSavedHole()
                                                }
                                            >
                                                Reset this hole
                                            </button>
                                        )}
                                    </div>

                                    <div className="score-submit-row">
                                        <button
                                            type="button"
                                            disabled={
                                                busy ||
                                                selectedShots.length === 0 ||
                                                (
                                                    !scoreDirty &&
                                                    Boolean(existing?.completed)
                                                )
                                            }
                                            onClick={() =>
                                                void saveProgress()
                                            }
                                        >
                                            <Save size={16} />
                                            Save progress
                                        </button>

                                        <button
                                            type="button"
                                            className="primary"
                                            disabled={busy || selectedShots.length === 0}
                                            onClick={() =>
                                                void finishHole()
                                            }
                                        >
                                            <CheckCircle size={16} />
                                            Complete hole
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        className="score-local-backup"
                                        disabled={
                                            busy ||
                                            selectedShots.length === 0 ||
                                            !scoreDirty
                                        }
                                        onClick={() =>
                                            void keepLocalBackup()
                                        }
                                    >
                                        <WifiOff size={15} />
                                        Keep a backup on this phone (not submitted)
                                    </button>

                                    {existing?.completed && !scoreDirty && (
                                        <p className="success-text">
                                            <Check size={16} />
                                            Hole completed. Select Edit to
                                            correct a saved stroke.
                                        </p>
                                    )}

                                    <div className="drive-totals">
                                        {scorePair.players.map(
                                            (player, index) => (
                                                <span key={player}>
                                                    {player}: {' '}
                                                    <b>
                                                        {metrics?.drives[index] ?? 0}
                                                        /{MIN_DRIVES}
                                                    </b>
                                                    {' '}tee shots ·{' '}
                                                    <b>
                                                        {metrics?.percent[index] ?? 0}%
                                                    </b>
                                                    {' '}selected shots
                                                </span>
                                            )
                                        )}
                                    </div>

                                    {offlineQueue.length > 0 && (
                                        <button
                                            className="primary"
                                            disabled={!online || busy}
                                            onClick={() =>
                                                void syncPending()
                                            }
                                        >
                                            <RefreshCw size={16} />
                                            Sync {offlineQueue.length} offline hole(s)
                                        </button>
                                    )}

                                    <p className="fine-print">
                                        Five selected tee shots per player
                                        are compulsory. Incomplete rounds
                                        and unsynced offline scores are
                                        excluded from final net standings.
                                    </p>
                                </div>

                                <div className="hole-grid">
                                    {scoreHoles.map((number, index) => {
                                        const card = state.scores.find(
                                            score => score.pairId === scorePair.id &&
                                                score.hole === number
                                        );

                                        return (
                                            <button
                                                key={number}
                                                className={
                                                    index === holeIndex
                                                        ? 'current'
                                                        : card?.completed
                                                            ? 'recorded'
                                                            : ''
                                                }
                                                onClick={() =>
                                                    goToHole(index)
                                                }
                                            >
                                                H{number}

                                                <b>
                                                    {card?.completed
                                                        ? card.strokes + card.penalty
                                                        : card
                                                            ? '…'
                                                            : '—'}
                                                </b>

                                                <small>
                                                    {course2026[number - 1].metres} m
                                                </small>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="panel">
                                    <h3>Team shot contributions</h3>

                                    <div className="contribution-bars">
                                        {scorePair.players.map(
                                            (player, index) => (
                                                <div key={player}>
                                                    <div className="bar-row">
                                                        <span>{player}</span>
                                                        <b>
                                                            {metrics?.selected[index]} selected ·
                                                            {metrics?.percent[index]}%
                                                        </b>
                                                    </div>

                                                    <div className="contribution-track">
                                                        <div style={{
                                                            width:
                                                                `${metrics?.percent[index] || 0}%`
                                                        }} />
                                                    </div>
                                                </div>
                                            )
                                        )}
                                    </div>

                                    <div className="stats-grid">
                                        <Stat
                                            label="Tee shots selected"
                                            value={`${metrics?.drives[0] ?? 0} / ` +
                                                `${metrics?.drives[1] ?? 0}`}
                                        />

                                        <Stat
                                            label="Team putts"
                                            value={metrics?.putts ?? 0}
                                        />

                                        <Stat
                                            label="Fairways"
                                            value={`${metrics?.fairways ?? 0}/` +
                                                `${metrics?.fairwayChances ?? 0}`}
                                        />

                                        <Stat
                                            label="Green approaches"
                                            value={metrics?.greens ?? 0}
                                        />
                                    </div>

                                    {metrics?.finished && (
                                        <>
                                            <p className={
                                                metrics.validDrives
                                                    ? 'success-text'
                                                    : 'warning-text'
                                            }>
                                                {metrics.validDrives
                                                    ? 'Minimum five drives satisfied by both players.'
                                                    : 'A player has fewer than five selected tee shots. The round cannot be confirmed.'}
                                            </p>

                                            <p>
                                                Scorecard confirmations:{' '}
                                                {confirmed
                                                    .map(c => c.player_name)
                                                    .join(' and ') ||
                                                    'None yet'}
                                            </p>

                                            <button
                                                className="primary"
                                                disabled={
                                                    busy ||
                                                    myConfirmed ||
                                                    !metrics.validDrives ||
                                                    scoreDirty ||
                                                    offlineQueue.some(
                                                        s => s.pairId === scorePair.id
                                                    ) ||
                                                    !scorePair.players.includes(me)
                                                }
                                                onClick={() =>
                                                    void confirm()
                                                }
                                            >
                                                {myConfirmed
                                                    ? 'You have confirmed this card'
                                                    : 'Confirm my 18-hole scorecard'}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                    </>
                )}

                {tab === 'leaderboard' && (
                    <>
                        {heading(
                            'LIVE RESULTS',
                            'Leaderboard',
                            'Provisional stroke-play standings, team handicaps and shot contributions.'
                        )}

                        <div className="panel">
                            <div className="responsive-table">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Pos</th>
                                            <th>Pair</th>
                                            <th>Thru</th>
                                            <th>Gross</th>
                                            <th>HCP</th>
                                            <th>Net</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>

                                    <tbody>
                                        {leaderboard.map((entry, index) => (
                                            <tr key={entry.pair.id}>
                                                <td className="gold">
                                                    {index + 1}
                                                </td>

                                                <td>
                                                    {entry.pair.players.join(' & ')}
                                                </td>

                                                <td>{entry.holes}/18</td>

                                                <td>
                                                    {entry.holes
                                                        ? entry.strokes
                                                        : '—'}
                                                </td>

                                                <td>
                                                    {entry.pair.hcp?.toFixed(2) ?? 'TBC'}
                                                </td>

                                                <td>
                                                    {entry.net?.toFixed(2) ?? '—'}
                                                </td>

                                                <td>
                                                    {entry.finished
                                                        ? entry.validDrives
                                                            ? 'Complete'
                                                            : 'Drive minimum missing'
                                                        : 'Playing'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <p className="fine-print">
                                Only completed holes count toward gross and net.
                                Full-round net requires 18 holes and at least
                                five selected drives from each player.
                                Final ties and results require Director verification.
                            </p>
                        </div>

                        <div className="pair-grid">
                            {leaderboard.map(entry => (
                                <div
                                    key={entry.pair.id}
                                    className="pair-card"
                                >
                                    <h3>
                                        {entry.pair.players.join(' & ')}
                                    </h3>

                                    <p>
                                        Selected shots: {entry.percent[0]}%
                                        {' '}/{' '}
                                        {entry.percent[1]}%
                                    </p>

                                    <p>
                                        Tee drives: {entry.drives[0]}
                                        {' '}/{' '}
                                        {entry.drives[1]}
                                        {' '}· Putts: {entry.putts}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {tab === 'rules' && (
                    <>
                        {heading(
                            '2026 REGULATIONS',
                            'Rules & Course',
                            "Two-person Ambrose stroke play · Men's white tees · No GPS required."
                        )}

                        <div className="rule-grid">
                            {[
                                [
                                    '01',
                                    'Format',
                                    'Two-person Ambrose. Both golfers play each stroke and choose one ball to continue from. Record the owner of every selected stroke.'
                                ],
                                [
                                    '02',
                                    'Five-drive minimum',
                                    'Each player must contribute at least five selected tee shots across 18 holes. An invalid round cannot be signed off.'
                                ],
                                [
                                    '03',
                                    'Handicap',
                                    '35% of the lower approved handicap plus 15% of the higher, rounded to two decimals.'
                                ],
                                [
                                    '04',
                                    'Scorecard',
                                    '18-hole par 72. White tees total 5,719 metres. Hole lengths and stroke indexes are listed below.'
                                ],
                                [
                                    '05',
                                    'Verification',
                                    'Both partners confirm the scorecard after all 18 holes. Any edit invalidates previous confirmations.'
                                ],
                                [
                                    '06',
                                    'Director',
                                    'The Director validates final net standings, ties and any disputed records.'
                                ]
                            ].map(([number, title, body]) => (
                                <div
                                    key={number}
                                    className="panel rule"
                                >
                                    <span className="eyebrow">
                                        RULE {number}
                                    </span>

                                    <h3>{title}</h3>
                                    <p>{body}</p>
                                </div>
                            ))}
                        </div>

                        <div className="panel">
                            <h3>
                                Clare Golf Club · Men's white tees
                            </h3>

                            <p>
                                {METRES_TOTAL.toLocaleString()} metres · Par 72
                            </p>

                            <div className="responsive-table">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Hole</th>
                                            <th>Metres</th>
                                            <th>Par</th>
                                            <th>SI</th>
                                        </tr>
                                    </thead>

                                    <tbody>
                                        {course2026.map(hole => (
                                            <tr key={hole.hole}>
                                                <td>{hole.hole}</td>
                                                <td>{hole.metres} m</td>
                                                <td>{hole.par}</td>
                                                <td>{hole.si}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <p className="fine-print">
                                Source: supplied Golfify Clare scorecard,
                                shorter White column.
                                Confirm the club's current scorecard before tee-off.
                            </p>
                        </div>
                    </>
                )}

                {tab === 'admin' && (
                    <>
                        {heading(
                            'EVENT OPERATIONS',
                            director
                                ? 'Tournament Director'
                                : 'Player Account',
                            director
                                ? 'Manage tournament access, the draw and final scorecards.'
                                : 'Use your individual four-digit PIN to access player preferences and scoring.'
                        )}

                        <div className="panel">
                            <h3>Account</h3>

                            {role === 'guest' ? (
                                <div className="login-row">
                                    <select
                                        value={loginName}
                                        onChange={event =>
                                            setLoginName(event.target.value)
                                        }
                                        aria-label="Player name"
                                    >
                                        {field.map(name => (
                                            <option key={name}>
                                                {name}
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
                                            setPin(event.target.value
                                                .replace(/\D/g, '')
                                                .slice(0, 4))
                                        }
                                        onKeyDown={event => {
                                            if (event.key === 'Enter') {
                                                void login();
                                            }
                                        }}
                                    />

                                    <button
                                        disabled={busy || pin.length !== 4}
                                        className="primary"
                                        onClick={() => void login()}
                                    >
                                        <LogIn size={16} />
                                        Log in
                                    </button>
                                </div>
                            ) : (
                                <div className="bar-row">
                                    <p>
                                        Signed in:{' '}
                                        <strong>
                                            {director
                                                ? 'Joshua Clarke · Tournament Director'
                                                : me}
                                        </strong>
                                    </p>

                                    <button onClick={() => void logout()}>
                                        Sign out
                                    </button>
                                </div>
                            )}
                        </div>

                        {loggedIn && !director && (
                            <div className="panel">
                                <h3>My tournament</h3>

                                <p>
                                    Submit your two preferences in The Field.
                                    Once the draw is released, your partner,
                                    starting hole and scoring link appear
                                    on the Home screen.
                                </p>

                                <button
                                    className="primary"
                                    onClick={() => setTab('field')}
                                >
                                    My preferences
                                </button>
                            </div>
                        )}

                        {director && (
                            <>
                                <div className="panel">
                                    <h3>Director controls</h3>

                                    <div className="stats-grid">
                                        <Stat
                                            label="Preferences received"
                                            value={`${votes.length}/26`}
                                        />

                                        <Stat
                                            label="Pairs"
                                            value={state.pairs.length}
                                        />

                                        <Stat
                                            label="Event status"
                                            value={state.eventStatus.toUpperCase()}
                                        />

                                        <Stat
                                            label="Confirmed cards"
                                            value={state.pairs.filter(pair =>
                                                confirmations.filter(c =>
                                                    c.pair_id === pair.id
                                                ).length === 2
                                            ).length}
                                        />
                                    </div>

                                    <div className="btn-row">
                                        <button
                                            onClick={() => setTab('draw')}
                                        >
                                            <Shuffle size={16} />
                                            Manage the draw
                                        </button>

                                        <button
                                            onClick={() => setTab('leaderboard')}
                                        >
                                            <BarChart3 size={16} />
                                            Review scores
                                        </button>

                                        {state.eventStatus === 'live' && (
                                            <button
                                                disabled={busy}
                                                className="primary"
                                                onClick={() =>
                                                    void finishEvent()
                                                }
                                            >
                                                <Trophy size={16} />
                                                Finalise tournament
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="panel">
                                    <h3>
                                        Approved player handicaps
                                    </h3>

                                    <p>
                                        Stored in Supabase.
                                        Handicap values remain saved
                                        after the app closes.
                                    </p>

                                    <div className="hcp-grid">
                                        {state.players.map(player => (
                                            <label key={player.name}>
                                                {player.name}

                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    placeholder="TBC"
                                                    disabled={
                                                        state.eventStatus === 'live' ||
                                                        state.eventStatus === 'final'
                                                    }
                                                    value={
                                                        hcpDrafts[player.name] ??
                                                        (player.handicap ?? '')
                                                    }
                                                    onChange={event =>
                                                        setHcpDrafts(old => ({
                                                            ...old,
                                                            [player.name]:
                                                                event.target.value
                                                        }))
                                                    }
                                                    onBlur={() =>
                                                        void changeHandicap(player.name)
                                                    }
                                                />
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="panel">
                                    <h3>
                                        Competition safeguards
                                    </h3>

                                    <p>
                                        Draw launch requires all 26 preference
                                        forms and approved handicaps.
                                        Live scoring requires an authenticated
                                        pair member or authorised Director.
                                        Each completed scorecard needs 18 holes,
                                        five selected tee shots per player
                                        and both players' confirmations.
                                    </p>
                                </div>
                            </>
                        )}
                    </>
                )}
            </main>

            <footer>
                <span>BBCDM GOLF · EST. 2020</span>

                <span>
                    {online
                        ? <RefreshCw size={12} />
                        : <WifiOff size={12} />}

                    {' '}
                    {cloudEnabled
                        ? 'CLOUD CONNECTED'
                        : 'PREVIEW MODE'}

                    {' '}· THE GOLD STANDARD
                </span>
            </footer>
        </div>
    );
}

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
        <button className="action" onClick={onClick}>
            <div className="action-icon">{icon}</div>
            <strong>{title}</strong>
            <p>{sub}</p>
            <ChevronRight size={18} className="action-arr" />
        </button>
    );
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker
        .register('/sw.js')
        .catch(() => {});
}

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
