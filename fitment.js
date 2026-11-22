const fitmentAtom = /\*([A-Z0-9_]+)\*\s*=\s*([\w*.:/+\-]+)/i;
const fitmentTokens = new RegExp(`${fitmentAtom.source}|sbs:xxor\\b|and\\b|or\\b|[(),-]`, "gi");
const fitmentFields = {
  BUSREG: "Market", Z: "Trim", E: "Engine", T: "Transmission", Y: "Model year",
  R: "Seat trim", C: "Trim color", B: "Body", F: "Model", L: "Line",
  GEN: "Sales code", NAV_MODE: "EPC navigation mode", SET: "EPC set filter"
};
// FCA Fiat 124 Spider order codes BAFH27, BAFS27 and BAFX27.
const fiatTrims = {H: "Classica", S: "Lusso", X: "Abarth"};
const gearboxCodes = ["DAF", "DAG"];
const fitmentChoices = new Intl.ListFormat("en-US", {type: "disjunction"});

function parseFitment(rule) {
  const tokens = (rule.match(fitmentTokens) || []).map(token => token.replace(/\s/g, "").toUpperCase());
  if (tokens.join("") !== rule.replace(/\s/g, "").toUpperCase()) return null;
  let position = 0;
  function accept(token) {
    if (tokens[position] !== token) return false;
    position++;
    return true;
  }
  function expect(token) {
    if (!accept(token)) throw new SyntaxError(`Expected ${token}`);
  }
  function term() {
    if (accept("-")) return {op: "not", children: [term()]};
    if (accept("(")) {
      const result = expression();
      expect(")");
      return result;
    }
    if (accept("SBS:XXOR")) {
      expect("(");
      const children = [expression()];
      while (accept(",")) children.push(expression());
      expect(")");
      return {op: "xor", children};
    }
    const match = tokens[position++]?.match(fitmentAtom);
    if (!match) throw new SyntaxError("Expected EPC condition");
    return {field: match[1], value: match[2]};
  }
  function group(token, read) {
    const children = [read()];
    while (accept(token)) children.push(read());
    if (children.length === 1) return children[0];
    const op = token.toLowerCase();
    return {op, children: children.flatMap(child => child.op === op ? child.children : [child])};
  }
  function expression() {
    return group("OR", () => group("AND", term));
  }
  try {
    const result = expression();
    return position === tokens.length ? result : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function vehicleConditions(rule, year) {
  const tree = parseFitment(rule);
  if (!tree) return null;
  // Elide only top-level requirements already supplied by the catalog or its navigation mode.
  const conditions = tree.op === "and" ? tree.children : [tree];
  return conditions.filter(({field, value}) => !(field === "NAV_MODE"
    || (field === "F" && value === "BA") || (field === "B" && value === "27")
    || (field === "L" && value === "F") || (field === "Y" && value === String(year))));
}

function placementConditions(rules, year) {
  const clauses = rules.map(rule => rule ? vehicleConditions(rule, year) : []);
  if (!clauses.length || clauses.some(clause => clause?.length === 0)) return [];
  if (clauses.includes(null)) return null;
  const key = node => JSON.stringify(node);
  const keys = clauses.map(clause => new Set(clause.map(key)));
  const common = clauses[0].filter(node => keys.every(branch => branch.has(key(node))));
  const sharedKeys = new Set(common.map(key));
  // Each source row is an alternative. Keep unrelated conditions together.
  const alternatives = clauses.map(clause => clause.filter(node => !sharedKeys.has(key(node))));
  if (alternatives.some(clause => !clause.length)) return common;
  const unique = [...new Map(alternatives.map(clause => [JSON.stringify(clause), clause])).values()];
  if (unique.length === 1) return [...common, ...unique[0]];
  const branches = unique.map(clause => clause.length === 1 ? clause[0] : {op: "and", children: clause});
  const choices = branches.flatMap(node => node.op === "or" ? node.children : [node]);
  const field = choices[0].field;
  if (field && choices.every(node => node.field === field)) {
    const options = [...new Map(choices.map(node => [node.value, node])).values()];
    return [...common, options.length === 1 ? options[0] : {op: "or", children: options}];
  }
  return [...common, {op: "or", children: branches}];
}

function fitmentValue(field, value, year) {
  if (field === "BUSREG") return marketNames[value] || value;
  if (field === "Z" && fiatTrims[value]) return `${fiatTrims[value]} (${value})`;
  const key = `${field}|${value}`;
  const display = {
    "T|DSA": "Limited-slip differential (DSA)", "B|27": "2-door convertible", "F|BA": "Fiat 124 Spider (BA)",
    "E|EAM": "1.4 L MultiAir Turbo (EAM)", "T|DAF": "6-speed automatic (DAF)", "T|DAG": "6-speed manual (DAG)"
  }[key];
  if (display) return display;
  const description = epcResources.filters[key] || epcResources.filters[`${key}|0`] || epcDetails.labels[year]?.[key];
  return description ? `${description} (${value})` : value;
}

function fitmentCondition(node, year) {
  const [{field} = {}] = node.children || [];
  if (node.field || (node.op === "or" && field && node.children.every(child => child.field === field))) {
    const key = node.field || field;
    const values = node.field ? [node.value] : node.children.map(child => child.value);
    const label = key === "T" && values.every(value => value === "DSA") ? "Differential" : fitmentFields[key] || key;
    return `<strong>${escapeHtml(label)}</strong> ${escapeHtml(fitmentChoices.format(values.map(value => fitmentValue(key, value, year))))}`;
  }
  if (node.op === "not" && field) {
    const label = field === "T" && node.children[0].value === "DSA" ? "Differential" : fitmentFields[field] || field;
    return `<strong>Excludes ${escapeHtml(label.toLowerCase())}</strong> ${escapeHtml(fitmentValue(field, node.children[0].value, year))}`;
  }
  const label = {and: "All of these conditions", or: "At least one of these conditions", xor: "Exactly one of these conditions", not: "Excludes vehicles matching"}[node.op];
  return `<strong>${label}</strong><ul>${node.children.map(child => `<li>${fitmentCondition(child, year)}</li>`).join("")}</ul>`;
}

function fitmentMatcher(fields, knownSalesCodes = [], {gearboxOnly = false} = {}) {
  const evaluated = new Map();
  const salesCodes = new Set(knownSalesCodes);
  function status(node) {
    if (node.field) {
      const values = fields[node.field];
      if (!values || (node.field === "GEN" && !salesCodes.has(node.value))) return null;
      if (node.field === "T" && gearboxOnly && !gearboxCodes.includes(node.value)) return null;
      return values.includes(node.value);
    }
    const results = node.children.map(status);
    switch (node.op) {
      case "and": return results.includes(false) ? false : results.includes(null) ? null : true;
      case "or": return results.includes(true) ? true : results.includes(null) ? null : false;
      case "not": return results[0] === null ? null : !results[0];
      case "xor": {
        const matches = results.filter(value => value === true).length;
        return matches > 1 ? false : results.includes(null) ? null : matches === 1;
      }
    }
  }
  return rule => {
    if (!rule) return true;
    if (evaluated.has(rule)) return evaluated.get(rule);
    const tree = parseFitment(rule);
    const conditions = tree?.op === "and" ? tree.children : [tree];
    // Navigation mode and set ranking are EPC controls, not vehicle equipment.
    const result = tree ? status({op: "and", children: conditions.filter(({field}) => field !== "NAV_MODE" && field !== "SET")}) : null;
    evaluated.set(rule, result);
    return result;
  };
}
