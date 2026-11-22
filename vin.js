const spiderVinYears = {H: 2017, J: 2018, K: 2019, L: 2020};
const vinLetters = "ABCDEFGHJKLMNPRSTUVWXYZ";
const vinLetterValues = [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 7, 9, 2, 3, 4, 5, 6, 7, 8, 9];
const vinWeights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function spiderVin(value) {
  const vin = value.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new Error("Enter a 17-character VIN. VINs use letters and digits, except I, O, and Q.");
  const year = spiderVinYears[vin[9]];
  if (!/^JC1NFAEK[0-9X][HJKL]0\d{6}$/.test(vin) || !year) {
    throw new Error("This VIN is outside the supported North American 2017–2020 Fiat 124 Spider range.");
  }
  const sum = [...vin].reduce((total, char, i) => total + vinWeights[i] * (/\d/.test(char) ? Number(char) : vinLetterValues[vinLetters.indexOf(char)]), 0);
  const digit = sum % 11;
  if (vin[8] !== (digit === 10 ? "X" : String(digit))) throw new Error("The VIN check digit does not match. Check the characters and try again.");
  return {vin, year, fields: {F: ["BA"], B: ["27"], L: ["F"], Y: [String(year)], E: ["EAM"]}};
}

async function lookupSpider(value) {
  const {vin, year, fields} = spiderVin(value);
  let index;
  if (window.crypto?.subtle) {
    const digest = new Uint8Array(await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(vin)));
    const key = Array.from(digest, n => n.toString(16).padStart(2, "0")).join("");
    index = epcVinIndex.entries[key];
  }
  if (!index) return {year, fields, factory: false};
  const [profile, optionSet, buildDate] = index;
  const mask = atob(epcVinIndex.optionSets[optionSet]);
  const optionCodes = epcVinIndex.optionCodes.filter((_, bit) => mask.charCodeAt(bit >> 3) & (1 << (bit & 7)));
  const date = String(buildDate);
  return {year, fields: {...fields, ...epcVinIndex.profiles[profile]}, factory: true,
    build: {date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`, optionCodes}};
}
