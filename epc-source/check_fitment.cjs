const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const read = name => readFileSync(join(root, name), 'utf8');
const data = name => JSON.parse(read(name).split(/=(.*)/s)[1].trim().replace(/;$/, ''));
const sandbox = vm.createContext({});
vm.runInContext(read('fitment.js'), sandbox);
const {parseFitment, vehicleConditions} = sandbox;
const sourceRules = new Set();
const add = rule => { if (rule) sourceRules.add(rule); };
const details = data('details.js');
for (const rules of Object.values(details.rules)) for (const [position] of Object.values(rules)) add(position);
for (const {rules} of Object.values(details.documents)) for (const rule of rules) add(rule);
for (const relation of details.relations) add(relation[9]);
let example;
for (const year of [2017, 2018, 2019, 2020]) {
  for (const [, page] of data(`${year}.js`).pages) {
    for (const item of page[5]) {
      add(item[7]);
      if (item[0] === 476242650) example = item[7];
    }
  }
}
for (const rule of sourceRules) assert.ok(parseFitment(rule), rule);
const simplified = JSON.parse(JSON.stringify(vehicleConditions(example, 2020)));
assert.deepEqual(simplified, [
  {op:'or', children:[{field:'BUSREG',value:'C'},{field:'BUSREG',value:'U'}]},
  {field:'E',value:'EAM'},
  {op:'or',children:[{field:'T',value:'DAF'},{field:'T',value:'DAG'}]},
  {field:'Z',value:'X'}
]);
const complex = parseFitment('((*BUSREG*=U) and -(*GEN*=RAD)) or sbs:xxor((*GEN*=PB1),(*GEN*=RB1))');
assert.equal(complex.op, 'or');
assert.equal(complex.children[0].children[1].op, 'not');
assert.equal(complex.children[1].op, 'xor');
assert.equal(parseFitment('(*SET*=YES)*1000'), null);
console.log(`${sourceRules.size} EPC vehicle expressions parsed, including grouped alternatives and exclusions.`);

const partial = sandbox.fitmentMatcher({Y:['2018'], E:['EAM']}, ['RAD']);
assert.equal(partial('(*Y*=2018) and (*Z*=X)'), null);
assert.equal(partial('(*Y*=2018) and -(*GEN*=RAD)'), null);
assert.equal(partial('(*Y*=2018) or (*GEN*=RAD)'), true);
assert.equal(partial('(*Y*=2020) or (*GEN*=RAD)'), null);
assert.equal(partial('(*Y*=2020) and (*GEN*=RAD)'), false);
const confirmed = sandbox.fitmentMatcher({Y:['2018'], Z:['X'], GEN:[]}, ['RAD']);
assert.equal(confirmed('(*Y*=2018) and (*Z*=S)'), false);
assert.equal(confirmed('(*Y*=2018) and (*NAV_MODE*=2) and -(*GEN*=RAD)'), true);
assert.equal(confirmed('(*Y*=2018) and -(*GEN*=NEW)'), null);
assert.equal(confirmed('sbs:xxor((*Y*=2018), (*GEN*=NEW))'), null);
assert.equal(confirmed('sbs:xxor((*Y*=2018), (*Z*=X), (*GEN*=NEW))'), false);
const vinIndex = data('vin-data.js');
assert.equal(Object.keys(vinIndex.entries).length, 17414);
assert.ok(Object.keys(vinIndex.entries).every(key => /^[a-f0-9]{64}$/.test(key)));
assert.equal(vinIndex.optionCodes.length, 505);
assert.equal(vinIndex.optionSets.length, 12841);
const salesCodes = new Set(vinIndex.salesCodes);
const decoded = vinIndex.optionSets.map(mask => {
  const bytes = Buffer.from(mask, 'base64');
  assert.equal(bytes.length, Math.ceil(vinIndex.optionCodes.length / 8));
  return vinIndex.optionCodes.filter((_, bit) => bytes[bit >> 3] & (1 << (bit & 7)));
});
for (const [profile, set, date] of Object.values(vinIndex.entries)) {
  assert.ok(vinIndex.profiles[profile]);
  assert.ok(decoded[set].length >= 87);
  assert.match(String(date), /^20\d{6}$/);
  assert.deepEqual(decoded[set].filter(code => salesCodes.has(code)), vinIndex.profiles[profile].GEN);
}
const manual = sandbox.fitmentMatcher({T:['DAG']}, [], {gearboxOnly: true});
assert.equal(manual('(*T*=DAG) and (*T*=DSA)'), null);
assert.equal(manual('(*T*=DAG) and -(*T*=DSA)'), null);
assert.equal(manual('(*T*=DAF) and (*T*=DSA)'), false);
assert.equal(sandbox.fitmentMatcher({T:['DAG','DSA']})('(*T*=DAG) and (*T*=DSA)'), true);
assert.equal(sandbox.fitmentMatcher({T:['DAG']})('(*T*=DAG) and (*T*=DSA)'), false);
assert.equal(Object.keys(details.chapterImages).length, 644);
assert.equal(new Set(Object.values(details.chapterImages)).size, 88);
assert.equal(Object.keys(details.diagramLabels).length, 186);
console.log('Partial VIN retains unknown differential variants. Factory VIN equipment, diagram labels and chapter images verified.');

vm.runInContext(read('synonyms.js'), sandbox);
assert.equal(sandbox.matchesSearchText('WIRING, INSTRUMENT PANEL', sandbox.searchQueries('dashboard wiring')), true);
assert.equal(sandbox.matchesSearchText('STABILIZER BAR', sandbox.searchQueries('sway bar')), true);
assert.equal(sandbox.matchesSearchText('INSTRUMENT PANEL', sandbox.searchQueries('kdashboard')), false);

const rear = data('2017.js').pages.find(([id]) => id === 8085219)[1];
const positionRules = number => rear[5].filter(item => item[3] === number).map(item => item[7]);
const leftRod = sandbox.placementConditions(positionRules('68313177AA'), 2017);
const leftOptions = leftRod.find(node => node.op === 'or' && node.children.every(child => child.field === 'Z'));
assert.equal(leftOptions.children.map(child => child.value).join(','), 'S,X');
assert.ok(leftRod.some(node => node.field === 'GEN' && node.value === 'LM6'));
assert.ok(!JSON.stringify(leftRod).includes('NAV_MODE'));
const otherRod = sandbox.placementConditions(positionRules('68313934AA'), 2017);
const otherBranches = otherRod.find(node => node.op === 'or' && node.children.every(child => child.op === 'and'));
assert.equal(otherBranches.children.length, 2);
assert.ok(otherBranches.children.some(branch => branch.children.some(node =>
  node.op === 'not' && node.children[0].field === 'GEN' && node.children[0].value === 'LM6')));
assert.ok(otherBranches.children.some(branch => branch.children.some(node => node.field === 'GEN' && node.value === 'LMC')));
assert.deepEqual(Array.from(sandbox.placementConditions(['', '(*GEN*=LM6)'], 2017)), []);
console.log('Repeated placements combine trim alternatives and preserve separate sales-code conditions.');

assert.equal(Object.keys(details.diagramOrder).length, 48);
const gallery = details.diagramOrder[42406979];
assert.deepEqual(gallery, [36557908,36557565,36557000,36556820,36558025,36557210,31569314,31572544]);
for (const year of [2017,2018,2019,2020]) {
  for (const [id, page] of data(`${year}.js`).pages) {
    const images = details.diagramOrder[id] || page[2];
    assert.deepEqual([...images].sort(), [...page[2]].sort());
    assert.ok(page[5].every(item => images.includes(item[2])));
    images.forEach((image,index) => {
      const caption = details.diagramLabels[image];
      if (caption) assert.equal(caption, `Multiple Arts ${index+1} of ${images.length}`);
    });
  }
}
console.log('All 48 multi-image pages use EPC order and retain their original part-to-image associations.');
