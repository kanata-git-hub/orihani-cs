// An exact clinic vocabulary, not a diagnosis inferred from the last syllable.
// Private names and abbreviations can also be supplied explicitly as “처방명: …”.
const formulaNames = `
갈근탕 갈근해기탕 가미귀비탕 가미소요산 가미온담탕 감맥대조탕 감초사심탕 감초탕 감수반하탕
계마각반탕 계지탕 계지가작약탕 계지가갈근탕 계지가용골모려탕 계지복령환 경방패독산 경옥고
공진단 곽향정기산 교애탕 구미강활탕 궁귀조혈음 귀비탕 귀기건중탕 당귀건중탕 당귀사역탕
당귀사역가오수유생강탕 당귀수산 당귀육황탕 당귀음자 당귀작약산 대건중탕 대시호탕 대승기탕 대청룡탕 대황목단피탕
독활기생탕 독활지황탕 도핵승기탕 마자인환 마황탕 마행감석탕 맥문동탕 목방기탕 반하백출천마탕 반하사심탕
반하후박탕 방기황기탕 방풍통성산 배농산급탕 백호가인삼탕 백호탕 보양환오탕 보중익기탕 보허탕 복령음 복령음합반하후박탕
분심기음 불환금정기산 비화음 사군자탕 사령산 사물탕 사삼맥문동탕 사역산 사역탕 삼령백출산 삼소음 삼출건비탕
삼황사심탕 생강사심탕 생맥산 소건중탕 소경활혈탕 소시호탕 소요산 소청룡탕 소풍산 속명탕 수비전 승마갈근탕 시경반하탕
시령탕 시박탕 시호가용골모려탕 시호계지건강탕 시호계지탕 시호소간산 신기환 신이청폐탕 십미패독탕 십전대보탕 쌍화탕
안중산 억간산 여택통기탕 연교패독산 영강출감탕 영계출감탕 오령산 오림산 오수유탕 오약순기산 오적산 온경탕
온담탕 온백원 온비탕 온청음 온토육린탕 오자연종환 용담사간탕 우귀환 우차신기환 월비가출탕 위령탕 위풍탕
육군자탕 육미지황원 육미지황탕 육미지황환 육미환 은교산 이중탕 이진탕 이향산 익기보혈탕 인삼양영탕 인삼패독산 인진오령산
인진호탕 자감초탕 자음강화탕 작약감초탕 작감탕 저령탕 전씨백출산 정전가미이진탕 제생신기환 조경종옥탕 조위승기탕
죽엽석고탕 지백지황환 지실소비환 지실작약산 지황음자 진무탕 창부도담탕 천궁다조산 천왕보심단 청상방풍탕 청서익기탕
청심연자음 청심연자탕 청폐탕 총명탕 통규활혈탕 통도산 팔미지황원 팔미지황탕 팔미지황환 팔물탕 팔진탕 평위산 향사육군자탕
향사평위산 향소산 행소탕 형개연교탕 향부자팔물탕 화개산 황기건중탕 황금탕 황련아교탕 황련해독탕 황련탕 회춘양격산
溫清飲 温清飲 半夏瀉心湯 半夏泻心汤`.trim().split(/\s+/);

const label = /(?:처방명|한약명|약명|처방|처방약|복용약)\s*[:：=]\s*/u;
const privateFormula = /^(?:(?:가미|가감|원내|자체)[가-힣A-Za-z0-9-]{1,24}(?:탕|산|환|음|단|고|방)|[\p{Script=Han}]{2,20}[湯汤丸散方])$/u;
const medicineSlot = /(?:^|[^\p{L}\p{N}_])(?:한약|일반한약|탕약|처방약|복용약|약)\s*[(（]([^()（）\n]{1,240})[)）]/gu;
const localMedicineCode = /^[가-힣]{2,16}[A-Za-z]\d[A-Za-z0-9-]{0,12}$/u;
const compact = (value: string) => value.normalize('NFKC').replace(/[\s\u200B-\u200D\uFEFF]+/gu, '');
const cleanTerm = (value: string) => value.trim().replace(/^[('"“‘「『\[]+|[)'"”’」』\]]+$/gu, '').trim();
const generic = new Set(['한약', '탕약', '약', '미정', '미입력', '미확인', '없음', '미기재', '미지정', '확인', '보류', '변경', '유지', '예정', '기존', '이전', '신규', '조정', '검토', '상담', '없습니다', '없어요']);
const ambiguous = '질환·증상에는 증상만 남겨 주세요. 처방 이름은 사용한 처방명 칸에, 복용 전후 상황은 메시지/상황에 나눠 적어 주세요.';

function referenced(text: string, extra: string[] = []): string[] {
  const normalized = compact(text);
  const names = [...new Set([...extra, ...formulaNames])].filter(name => name && !generic.has(name) && normalized.includes(compact(name)));
  return names.sort((a, b) => b.length - a.length);
}

export function getReferencedPrescriptions(...fields: string[]): string[] {
  const text = fields.join('\n');
  const names = referenced(text);
  for (const match of text.matchAll(new RegExp(label.source + '[“"‘(「『]?([가-힣A-Za-z0-9_\u3400-\u9FFF-]{2,40})', 'gu'))) {
    if (!generic.has(match[1])) names.push(match[1]);
  }
  for (const slot of text.matchAll(medicineSlot)) {
    for (const raw of slot[1].split(/[+＋,，/]/u)) {
      const name = cleanTerm(raw);
      if (privateFormula.test(name) || localMedicineCode.test(name)) names.push(name);
    }
  }
  return [...new Set(names)];
}

export function isKnownPrescriptionName(name: string): boolean {
  return formulaNames.includes(compact(name));
}

export function getEnteredPrescriptionNames(value = ''): string[] {
  return [...new Set(value.split(/[+＋,，、/;；\n]+/u)
    .map(part => compact(cleanTerm(part.trim().replace(new RegExp('^' + label.source, 'u'), ''))))
    .filter(name => name && !generic.has(name)))];
}

export function getEffectPrescriptionNames(message: string, direction: string, prescriptionName = ''): string[] {
  const result = new Set(getEnteredPrescriptionNames(prescriptionName));
  for (const field of [message, direction]) {
    const names = getReferencedPrescriptions(field).map(name => {
      const bare = name.replace(/(?:입니다|인데요|으로|을|를|은|는|과|와)$/u, '');
      return isKnownPrescriptionName(bare) ? bare : name;
    });
    if (!names.length) continue;
    // A named compound is one formula. An explicitly repeated standalone component still counts.
    // The vocabulary and label parser supply only letters, digits, underscores and hyphens.
    const pattern = new RegExp(names.sort((a, b) => b.length - a.length).map(compact).join('|'), 'gu');
    for (const match of compact(field).matchAll(pattern)) result.add(match[0]);
  }
  return [...result];
}

export function findDisclosedPrescription(text: string, inputNames: string[] = []): string | null {
  return referenced(text, inputNames)[0] || null;
}

export function inspectSymptomField(raw: string, inputNames: string[] = []) {
  const original = raw.trim();
  const symptoms: string[] = [];
  const prescriptions: string[] = [];
  let error: string | null = null;
  for (const item of original.split(/[,，、/·;；\n+＋]+/u).map(part => part.trim()).filter(Boolean)) {
    const marked = item.match(label);
    const term = cleanTerm(marked?.index === 0 ? item.slice(marked[0].length) : item);
    const token = compact(term);
    const candidates = referenced(term, inputNames);
    const forms = candidates.map(compact);
    const base = token.replace(/^(가미|가감)/u, '').replace(/(?:가감방|가미방|합방|가감|가미)$/u, '');
    const isFormula = forms.includes(token) || forms.includes(base) || privateFormula.test(term);
    if (isFormula || (marked?.index === 0 && !generic.has(term) && /^[가-힣A-Za-z0-9_\u3400-\u9FFF-]{1,40}$/u.test(term))) {
      prescriptions.push(term);
    } else if (marked || candidates.length || /^(?:한약|탕약)$/u.test(term) ||
               (/^[가-힣]{2,}탕$/u.test(term) && !term.endsWith('진탕')) ||
               /(?:[가-힣]{2,}(?:탕|환|산|음|단|방)|[A-Za-z]+[0-9][A-Za-z0-9-]*)\s*(?:을|를)?\s*(?:복용|투약|처방)/u.test(item)) {
      error = ambiguous;
    } else {
      symptoms.push(item);
    }
  }
  return {
    symptoms: prescriptions.length || error ? symptoms.join(', ') : original,
    prescriptions: [...new Set(prescriptions)],
    error,
  };
}
