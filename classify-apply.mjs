// Apply per-criterion classification to a study.json.
// Usage: node classify-apply.mjs <study.json> '<JSON map>'
//   map: { "INC-3": "self_report:hard", "EXC-1": "self_report:hard", ... }
//   Unlisted criteria default to "records:none" (safe — never phone_screenable).
//   phone_screenable is derived = (self_report && hard).
import fs from 'node:fs';
const [, , jsonPath, mapStr] = process.argv;
if (!jsonPath || !mapStr) { console.error('need <study.json> <map>'); process.exit(1); }
const S = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const map = JSON.parse(mapStr);
const DEFAULT = 'records:none';

function apply(arr, prefix) {
  for (const c of arr || []) {
    const id = `${prefix}-${c.criterion_number}`;
    const [vm, ks] = (map[id] || DEFAULT).split(':');
    c.verification_method = vm;
    c.knockout_strength = ks;
    c.phone_screenable = vm === 'self_report' && ks === 'hard';
  }
}
apply(S.inclusionCriteria, 'INC');
apply(S.exclusionCriteria, 'EXC');

fs.writeFileSync(jsonPath, JSON.stringify(S, null, 2));
const phone = [
  ...(S.inclusionCriteria || []).map(c => ['INC', c]),
  ...(S.exclusionCriteria || []).map(c => ['EXC', c]),
].filter(([, c]) => c.phone_screenable).map(([p, c]) => `${p}-${c.criterion_number}`);
console.log(`classified ${jsonPath}: phone_screenable = [${phone.join(', ')}]`);
