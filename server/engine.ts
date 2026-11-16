import {randomUUID} from 'node:crypto';
import {Store} from './store.ts';
import {callModel,ModelError} from './model.ts';
import {current,validatePlan,type Job,type Plan,type Workflow,type Question} from '../shared/domain.ts';
export const active=(j?:Job)=>!!j&&['analyzing','orchestrating'].includes(j.status);
const fail=(m:string)=>{throw Object.assign(new Error(m),{status:409})};
export function checkQuestions(q:unknown):Question[]{if(!Array.isArray(q)||!q.length||q.some(x=>!x||typeof x.id!=='string'||!x.id||typeof x.text!=='string'||!x.text.trim()||typeof x.reason!=='string')||new Set(q.map(x=>x.id)).size!==q.length)throw new ModelError('澄清问题结构无效',true);return q}
export class Engine {
 controllers=new Map<string,AbortController>();
 constructor(public store:Store,public provider=callModel){for(const w of store.all())if(active(w.job))store.mutate(w.id,w=>{w.job!.status='interrupted';w.job!.error='服务已重启，生成中断；不会自动重新调用。请重试。'})}
 start(id:string,expected:number,feedback:string){
 if(!process.env.DEEPSEEK_API_KEY)throw Object.assign(new Error('请先在后端 .env 配置 DEEPSEEK_API_KEY'),{status:400});
 const w=this.store.mutate(id,w=>{if(active(w.job))fail('生成进行中');if(w.candidate)fail('请先采用或放弃候选');const settings=this.store.settings();w.job={id:randomUUID(),status:'analyzing',stage:'pm',requirement:structuredClone(w.requirement),settings,base:current(w)?.plan,feedback,answers:[],questions:[],issues:[],preview:'',usage:null,attempt:1,createdAt:new Date().toISOString(),isRegeneration:!!w.currentId};},expected);void this.run(id,w.job!.id);return w;
 }
 cancel(id:string){const w=this.store.mutate(id,w=>{if(!active(w.job))fail('本次生成已结束');w.job!.status='cancelled';w.job!.error='用户已取消；服务商可能仍在处理在途请求'});this.controllers.get(id)?.abort();return w}
 retry(id:string,expected:number,answer?:string){const w=this.store.mutate(id,w=>{const j=w.job;if(!j||active(j))fail('没有可重试请求');if(j!.requirement.version!==w.requirement.version)fail('原需求已过期，请重新生成');
 if(answer!==undefined){if(!['waiting','issues'].includes(j!.status)||!answer.trim())fail('请填写待处理问题的回答');j!.answers.push({questions:j!.questions,answer});j!.questions=[];j!.issues=[];j!.pm=undefined;j!.result=undefined;j!.stage='pm'}else if(!['failed','cancelled','interrupted','save_failed'].includes(j!.status))fail('当前状态不能重试');
 j!.id=randomUUID();j!.attempt++;j!.status=j!.pm?'orchestrating':'analyzing';j!.error=undefined;j!.preview='';
 },expected);void this.run(id,w.job!.id);return w}
 private update(id:string,jid:string,fn:(j:Job,w:Workflow)=>void){return this.store.mutate(id,w=>{if(w.job?.id!==jid||!active(w.job))throw new Error('STALE');fn(w.job,w)})}
 async run(id:string,jid:string){const controller=new AbortController();this.controllers.set(id,controller);const started=Date.now();let last=0;
 try{for(const stage of ['pm','orchestrator'] as const){let job=this.store.get(id).job!;if(job.id!==jid||!active(job))return;if(job.result)break;if(stage==='pm'&&job.pm)continue;
 this.update(id,jid,j=>{j.stage=stage;j.status=stage==='pm'?'analyzing':'orchestrating';j.preview=''});
 let repair='',complete=false;const limit=Math.max(1,Math.min(3,Number(process.env.MODEL_MAX_ATTEMPTS||2)));
 for(let n=0;n<limit;n++){try{job=this.store.get(id).job!;const response=await this.provider(job,stage,controller.signal,text=>{if(Date.now()-last>250){last=Date.now();this.update(id,jid,j=>{j.preview=text})}},repair);
 const value=response.result;
 if(stage==='pm'){
 if(value?.kind==='clarify'){const qs=checkQuestions(value.questions);this.update(id,jid,j=>{j.status='waiting';j.questions=qs;j.usage=response.usage;j.preview=''});return}
 if(value?.kind!=='ready'||!value.pm)throw new ModelError('PM 输出结构错误',true);
 const plan:Plan={pm:value.pm,agents:[],rationale:'',model:'deepseek-flash',effort:job.settings.downstreamEffort,requirementVersion:job.requirement.version,settings:job.settings};
 const errors=validatePlan(plan,job.requirement,false);if(errors.length)throw new ModelError(errors.map(e=>e.path+': '+e.message).join('; '),true);
 this.update(id,jid,j=>{j.pm=value.pm;j.usage=response.usage;j.preview=''});
 }else{
 if(value?.kind==='issues'){if(!Array.isArray(value.issues)||!value.issues.length||value.issues.some((x:unknown)=>typeof x!=='string'||!x.trim()))throw new ModelError('异议内容格式错误',true);const qs=checkQuestions(value.questions);this.update(id,jid,j=>{j.status='issues';j.issues=value.issues;j.questions=qs;j.preview='';j.usage=response.usage});return}
 if(value?.kind!=='ready'||!Array.isArray(value.agents)||!Array.isArray(value.assignments)||!value.rationale?.trim())throw new ModelError('编排输出结构错误',true);
 const tasks=structuredClone(job.pm!.tasks);if(value.assignments.length!==tasks.length||new Set(value.assignments.map((a:any)=>a.taskId)).size!==tasks.length||value.assignments.some((a:any)=>!tasks.some(t=>t.id===a.taskId)))throw new ModelError('分配必须精确覆盖全部任务',true);
 for(const t of tasks)t.agentId=value.assignments.find((a:any)=>a.taskId===t.id)?.agentId||'';
 const plan:Plan={pm:{...job.pm!,tasks},agents:value.agents,rationale:value.rationale,model:'deepseek-flash',effort:job.settings.downstreamEffort,requirementVersion:job.requirement.version,settings:job.settings};
 const errors=validatePlan(plan,job.requirement);if(errors.length)throw new ModelError(errors.map(e=>e.path+': '+e.message).join('; '),true);
 this.update(id,jid,j=>{j.result=plan;j.stage='save';j.usage=response.usage;j.preview=''});
 }
 complete=true;break;
 }catch(e){if(controller.signal.aborted||!(e instanceof ModelError&&e.retryable)||n===limit-1)throw e;repair=(e as Error).message;this.update(id,jid,j=>{j.error=`校验或临时调用失败，正在有限重试：${repair}`});await new Promise(r=>setTimeout(r,250*(n+1)))}}
 if(!complete)throw new Error('阶段未完成');
 }
 this.update(id,jid,(j,w)=>{if(!j.result)throw new Error('结果不可用');if(j.isRegeneration||w.currentId||w.requirement.version!==j.requirement.version)w.candidate=j.result;else{const rev={id:randomUUID(),number:w.revisions.length+1,plan:j.result,createdAt:new Date().toISOString()};w.revisions.push(rev);w.currentId=rev.id}j.status='complete';j.error=undefined;j.elapsedMs=Date.now()-started});
 }catch(e){try{this.update(id,jid,j=>{j.status=j.result?'save_failed':'failed';j.error=e instanceof Error?(e.name==='TimeoutError'?'模型请求超时，请重试':e.message):'生成失败';j.elapsedMs=Date.now()-started})}catch{/* cancelled or stale: never accept late data */}}
 finally{if(this.controllers.get(id)===controller)this.controllers.delete(id)}
 }
}
