import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const home=homedir(),app=resolve(import.meta.dir,'..'),vault=resolve(import.meta.dir,'../../..');
const checks:{path:string;ok:boolean;reason?:string}[]=[];
for(const base of [join(home,'.codex/skills'),join(home,'.claude/skills'),join(vault,'.claude/skills'),join(vault,'.agents/skills'),join(vault,'experts/.agents/skills'),join(vault,'05_Biblioteca/OrganicoDTC/.agents/skills'),join(app,'.agents/skills')]){
  for(const skill of ['reference-hub','replicar-referencia','replicar-carrossel']){
    const path=join(base,skill,'SKILL.md'),source=join(app,'.claude/skills',skill,'SKILL.md');
    checks.push({path,ok:existsSync(path)&&realpathSync(path)===realpathSync(source)});
  }
}
for(const path of [join(vault,'AGENTS.md'),join(vault,'experts/AGENTS.md'),join(vault,'05_Biblioteca/OrganicoDTC/AGENTS.md'),join(app,'AGENTS.md')]){
  checks.push({path,ok:readFileSync(path,'utf8').includes('reference-hub/SKILL.md')});
}
for(const name of ['dtcwinner-manager','dtcwinner-video-director','dtcwinner-omni']){
  const path=join(vault,'experts/.claude/skills',name,'SKILL.md');
  checks.push({path,ok:readFileSync(path,'utf8').includes('reference-hub/SKILL.md')});
}
console.log(JSON.stringify({schema:'irh-entry-audit/v1',ok:checks.every(c=>c.ok),checks},null,2));
if(checks.some(c=>!c.ok))process.exitCode=1;
