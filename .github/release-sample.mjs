import { readFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { analysisEndpoint } from '../analysisApi.ts';
import { buildSystemInstruction } from '../src/constants/index.ts';
import { parseAnalysisResult } from '../src/patientMessageText.ts';
if (!process.env.GEMINI_API_KEY) {
  console.log('SAMPLE_UNAVAILABLE no Gemini credential configured for this isolated runner');
  process.exit(0);
}
const ai = new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
const release = readFileSync('server.ts','utf8');
const start = release.indexOf('  const sleep =');
const end = release.indexOf("  if (process.env.NODE_ENV",start);
if (start < 0 || end < 0) throw Error('Unrecognized release writer');
const setup = release.slice(start,end).replace('  app.use(\'/api/generate-analysis\', analysisEndpoint(', '  register(').replace('  }));','  });');
// TypeScript transpilation only; the writer and its fallback come verbatim from the release.
const {stripTypeScriptTypes} = await import('node:module');
let write;
new Function('ai','register',stripTypeScriptTypes(setup))(ai,(f)=>{write=f});
if (!write) throw Error('Writer missing');
const ticket = randomBytes(32).toString('hex');
const app=express();
app.use('/test',analysisEndpoint(write,(req,res,next)=>req.get('x-fixture')===ticket?next():res.sendStatus(403)));
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const cases=[
 {id:'fixed',patientName:'윤가온',symptoms:'눈 주위 가려움, 온청음',selectedTreatments:['한약'],selectedSituations:['일반한약 첫 15일 마무리 안내'],input:'',direction:''},
 {id:'free',patientName:'한가람',symptoms:'피부 붉어짐, 만성 소화불량',selectedTreatments:['한약'],selectedSituations:['한약 복용/경과'],input:'환자분은 식후 더부룩함이 전보다 줄었지만 피부의 붉은 기운은 비슷하다고 답했습니다. 다음 처방은 내원 후 결정하기로 했습니다.',direction:'소화가 좋아졌다는 말씀에 답하고 피부가 주로 언제 붉어지는지 물어보세요. 원장님은 한약 복용을 조금 더 이어 가시길 권하십니다. 자세한 치료 계획은 내원 시 상담하도록 안내하세요.'}];
try {
 for(const {id,...p} of cases){
  const prompt='[환자 및 상황 정보]\n환자 이름: '+p.patientName+'\n질환·증상: '+p.symptoms+'\n메시지/상황: '+(p.input||'정보 없음')+'\n선택된 치료: '+p.selectedTreatments.join(', ')+'\n응대 상황: '+p.selectedSituations.join(', ')+'\n추가 요청: '+(p.direction||'없음');
  const result=await fetch('http://127.0.0.1:'+server.address().port+'/test',{method:'POST',headers:{'content-type':'application/json','x-fixture':ticket},body:JSON.stringify({patientContext:p,systemInstruction:buildSystemInstruction(p.selectedTreatments,p.selectedSituations,p.symptoms+'\n'+p.input),prompt})});
  let data=await result.json();
  if(!result.ok||data.reviewed!==true){console.log('SAMPLE_FAILED '+JSON.stringify({id,http:result.status,code:data.code||'upstream'}));continue}
  const patient=parseAnalysisResult(data.text).responseDraft;
  console.log('PATIENT_SAMPLE '+JSON.stringify({id,patient,symptoms:data.symptoms}));
 }
}finally{server.close()}
