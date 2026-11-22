import {createClient} from '@supabase/supabase-js';
import type {AppState,Pair,Score} from './types';
import {initial} from './engine';
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
export const cloudEnabled=Boolean(url&&key);
export const supabase=cloudEnabled?createClient(url!,key!):null;
export async function getCloudState():Promise<AppState>{
 if(!supabase)return initial;
 const [p,t,s,e]=await Promise.all([supabase.from('players').select('name,handicap').order('name'),supabase.from('pairs').select('*').order('created_at'),supabase.from('hole_scores').select('*'),supabase.from('events').select('*').eq('id','bbcdm-2026').single()]);
 for(const x of [p,t,s,e])if(x.error)throw x.error;
 return {players:(p.data||[]).map((x:any)=>({name:x.name,handicap:x.handicap})),pairs:(t.data||[]).map((x:any)=>({id:x.id,players:[x.player_a,x.player_b],group:x.group_no,startHole:x.start_hole,locked:x.locked,published:x.published,hcp:x.team_handicap} as Pair)),scores:(s.data||[]).map((x:any)=>({pairId:x.pair_id,hole:x.hole,strokes:x.strokes,drive:x.selected_drive,penalty:x.penalty,updatedAt:x.updated_at} as Score)),eventStatus:e.data?.status||'registration',published:!!e.data?.draw_published};
}
export async function saveScore(v:Score){if(!supabase)return;const {error}=await supabase.from('hole_scores').upsert({pair_id:v.pairId,hole:v.hole,strokes:v.strokes,selected_drive:v.drive,penalty:v.penalty},{onConflict:'pair_id,hole'});if(error)throw error;}
export async function savePairs(pairs:Pair[]){if(!supabase)return;const {error}=await supabase.rpc('replace_draw',{new_pairs:pairs.map(p=>({id:p.id,player_a:p.players[0],player_b:p.players[1],group_no:p.group,start_hole:p.startHole,locked:p.locked,published:p.published,team_handicap:p.hcp}))});if(error)throw error;}
export async function setPublish(published:boolean){if(!supabase)return;const {error}=await supabase.from('events').update({draw_published:published}).eq('id','bbcdm-2026');if(error)throw error;}
export async function setStatus(status:AppState['eventStatus']){if(!supabase)return;const {error}=await supabase.from('events').update({status}).eq('id','bbcdm-2026');if(error)throw error;}
export async function setPlayerHcp(name:string,handicap:number|null){if(!supabase)return;const {error}=await supabase.from('players').update({handicap}).eq('name',name);if(error)throw error;}
export async function getRole(){if(!supabase)return 'demo';const {data:user}=await supabase.auth.getUser();if(!user.user)return 'guest';const {data}=await supabase.from('admin_users').select('role').eq('user_id',user.user.id).maybeSingle();if(data?.role)return data.role;const {data:acct}=await supabase.from('player_accounts').select('player_name').eq('user_id',user.user.id).maybeSingle();return acct?.player_name||'guest';}
