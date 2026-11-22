// US English synonyms in the September 2020 Chrysler EPC release.
const epcSynonyms = {
  "airbag": "air bag",
  "bcm": "module body controller",
  "buzzer": "alarm",
  "container": "reservoir",
  "dashboard": "instrument panel",
  "dipstick": "indicator engine oil level",
  "disk": "disc",
  "ecm": "module engine controller",
  "hatch": "liftgate",
  "hub cap": "cover wheel",
  "hubcap": "cover wheel",
  "jar": "reservoir",
  "liftgate": "tailgate",
  "moonroof": "sunroof",
  "mud": "shield splash",
  "mudguard": "shield splash",
  "pcm": "module powertrain control",
  "rcm": "module occupant restraint",
  "seatbelt": "seat belt",
  "shade": "visor",
  "sparkpulg": "spark plug",
  "strut": "shock",
  "sway": "stabilizer",
  "tailgate": "liftgate",
  "tpms": "sensor tire pressure",
  "tps": "sensor throttle position"
};

function searchText(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function searchQueries(query) {
  const normalized = searchText(query);
  if (!normalized) return [];
  const alternatives = new Set([normalized]);
  for (const [alias, term] of Object.entries(epcSynonyms)) {
    const phrase = ` ${normalized} `;
    if (phrase.includes(` ${alias} `)) alternatives.add(phrase.replaceAll(` ${alias} `, ` ${term} `).trim());
  }
  return [...alternatives].map(phrase => phrase.split(" "));
}

function matchesSearchText(value, queries) {
  const text = searchText(value);
  return queries.some(tokens => tokens.every(token => text.includes(token)));
}
