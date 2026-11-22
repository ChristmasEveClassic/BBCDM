export type HistoricalResult={year:number;position:string|null;score:number|null;players:string[];verification:'confirmed'|'pending';status:'finished'|'DNF'};
export type Hole={hole:number;par:number;si:number;yards:number};
export type Player={name:string;handicap:number|null;email?:string};
export type Pair={id:string;players:[string,string];group:number;startHole:number;locked:boolean;published:boolean;hcp:number|null};
export type Score={pairId:string;hole:number;strokes:number;drive:string;penalty:number;updatedBy?:string;updatedAt:string};
export type AppState={players:Player[];pairs:Pair[];scores:Score[];eventStatus:'registration'|'draw'|'live'|'final';published:boolean;};
