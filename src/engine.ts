import type {AppState,HistoricalResult,Pair,Score} from './types';
import data from './data.json';
export const roster:string[]=data.players;
export const results:HistoricalResult[]=data.results as HistoricalResult[];
export const course=data.course;
export const committee=data.committee as Record<string,string>;
export const founders=data.founders;
export const venues=data.venues as unknown as Record<string,[string,string]>;
export const initial:AppState={players:roster.map(name=>({name,handicap:null})),pairs:[],scores:[],eventStatus:'registration',published:false};
export const ordinal=(p:string|null)=>p||'DNF';
export const positionNum=(p:string|null)=>p?Number(p.replace(/[^0-9]/g,'')):999;
export function playerHistory(name:string){return results.filter(r=>r.players.includes(name)).sort((a,b)=>a.year-b.year)}
export function stats(name:string){const h=playerHistory(name), finishes=h.filter(r=>r.status==='finished');return {starts:new Set(h.map(r=>r.year)).size,titles:h.filter(r=>r.position==='1st').length,debut:h.length?Math.min(...h.map(r=>r.year)):null,best:finishes.length?finishes.reduce((a,b)=>positionNum(a.position)<positionNum(b.position)?a:b).position:null,podiums:finishes.filter(r=>positionNum(r.position)<=3).length,avg:finishes.length?(finishes.reduce((s,r)=>s+positionNum(r.position),0)/finishes.length):null};}
export function teamHandicap(a:number|null,b:number|null){if(a===null||b===null)return null;return Math.min(a,b)*.35+Math.max(a,b)*.15}
export function randomPairs(state:AppState):Pair[]{const locked=state.pairs.filter(p=>p.locked);const taken=new Set(locked.flatMap(p=>p.players));const others=state.players.map(p=>p.name).filter(n=>!taken.has(n));for(let i=others.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[others[i],others[j]]=[others[j],others[i]]}const made:Pair[]=[];for(let i=0;i+1<others.length;i+=2){const a=others[i],b=others[i+1],pa=state.players.find(x=>x.name===a),pb=state.players.find(x=>x.name===b);made.push({id:`pair-${i/2+1}-${Date.now()}`,players:[a,b],group:Math.floor(i/4)+1,startHole:1,locked:false,published:false,hcp:teamHandicap(pa?.handicap??null,pb?.handicap??null)})}return [...locked,...made].map((p,i)=>({...p,group:Math.floor(i/2)+1}));}
export function shotgunOrder(start:number){return Array.from({length:18},(_,i)=>(start+i-1)%18+1)}
export function pairScores(pairId:string,scores:Score[]){return scores.filter(s=>s.pairId===pairId)}
export function driveCounts(pair:Pair,scores:Score[]){const s=pairScores(pair.id,scores);return pair.players.map(p=>s.filter(x=>x.drive===p).length)}
export function penalties(pair:Pair,scores:Score[]){const s=pairScores(pair.id,scores);if(s.length<18)return 0;return driveCounts(pair,scores).reduce((n,c)=>n+Math.max(0,6-c)*2,0)}
export function standings(state:AppState){return state.pairs.map(p=>{const s=pairScores(p.id,state.scores);const gross=s.reduce((a,b)=>a+b.strokes+b.penalty,0);const par=s.reduce((a,b)=>a+(course.find(x=>x.hole===b.hole)?.par||0),0);const done=s.length===18;const pen=penalties(p,state.scores);return {pair:p,holes:s.length,gross:gross+pen,pen,relative:gross-par,net:done&&p.hcp!==null?gross+pen-p.hcp:null,done}}).sort((a,b)=>{if(a.done&&b.done&&a.net!==null&&b.net!==null)return a.net-b.net;if(a.done!==b.done)return a.done?-1:1;return a.relative-b.relative});}
export function sharedPastPartners(a:string,b:string){return results.filter(r=>r.players.includes(a)&&r.players.includes(b)).map(r=>r.year)}
