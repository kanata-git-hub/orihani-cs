export const HERBAL_DIRECTIONS = '한약은 하루 두 번 식후에 복용하시고, 냉장 보관해 주세요.';
export const DIET_HERBAL_DIRECTIONS = '한약은 하루 두 번 복용하시고, 한약과 한약 사이에는 6시간 이상 간격을 지켜 주세요. 다이어트약은 식전에 드시는 것이 좋지만, 약효가 일정하게 유지되는 것이 더 중요하기 때문에 식후에 드셔도 됩니다. 오늘 바로 드시지 않는 약은 냉장 보관해 주세요.';

// Two retired clinic instructions. Match a complete dosing instruction, never an appointment time.
const retiredTiming = /오전\s*9\s*[~～-]\s*11시와\s*오후\s*4\s*[~～-]\s*6시(?:쯤|경)?(?:에)?|식전[·,\s]*식후(?:와)?\s*(?:무관하게|상관없이)/u;
const retiredDirections = new RegExp([
  /(?:다이어트\s*)?한약은\s*하루\s*(?:두|2)\s*(?:번|회)[,\s]*/u.source,
  '(?:' + retiredTiming.source + ')',
  /\s*복용하시고[,\s]*(?:한약은\s*)?냉장\s*보관(?:해\s*주세요|해\s*주십시오|하세요|하시기\s*바랍니다)[.!]?/u.source,
].join(''), 'gu');

export function herbalDirectionsFor(treatments: string[]): string {
  if (treatments.includes('다이어트')) return DIET_HERBAL_DIRECTIONS;
  if (treatments.some(t => ['교통사고', '한약', '소화불량', '피로'].includes(t))) return HERBAL_DIRECTIONS;
  return '';
}

export function withHerbalDirections(patient: string, directions: string): string {
  if (!directions) return patient;
  const other = directions === DIET_HERBAL_DIRECTIONS ? HERBAL_DIRECTIONS : DIET_HERBAL_DIRECTIONS;
  const clean = patient.replaceAll(other, '').replace(retiredDirections, '').replace(/\n(?:[ \t]*\n){2,}/gu, '\n\n').trim();
  const parts = clean.split(directions);
  if (parts.length === 2) return clean;
  const paragraphs = parts.join('').trim().split(/\n\s*\n/u).map(p => p.trim()).filter(Boolean);
  // Keep the greeting first and a separate closing paragraph last.
  const position = paragraphs.length >= 3 ? paragraphs.length - 1 : paragraphs.length;
  paragraphs.splice(position, 0, directions);
  return paragraphs.join('\n\n');
}
