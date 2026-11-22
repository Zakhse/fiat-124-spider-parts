window.epcYears = {};
const years = [2017, 2018, 2019, 2020];
const marketNames = {U: "US", C: "Canada", M: "Mexico", B: "Export", K: "CKD"};
const main = document.querySelector("#main");
const layout = document.querySelector("#layout");
const sidebar = document.querySelector("#sidebar");
const sectionToggle = document.querySelector("#section-toggle");
const marketSelect = document.querySelector("#market");
const search = document.querySelector("#search");
const queryInput = document.querySelector("#query");
const vinForm = document.querySelector("#vin-form");
const vinInput = document.querySelector("#vin");
const vinStatus = document.querySelector("#vin-status");
const vinSeries = document.querySelector("#vin-series");
const vinTransmission = document.querySelector("#vin-transmission");
const clearVin = document.querySelector("#clear-vin");
let market = "";
let marketBeforeVin = "";
let vehicle = null;
let matchesVehicleRules = null;
let vehicleRequest = 0;
const vehiclePlacements = new Map();
let selectedImage = 0;
let selectedCallout = "";
let selectedItem = 0;
let renderId = 0;
const loaded = new Map();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function url(year, page = "", query = "", position = "") {
  const params = new URLSearchParams({year});
  if (page) params.set("page", page);
  if (query) params.set("q", query);
  if (position) params.set("item", position);
  return "#" + params;
}

function route() {
  const params = new URLSearchParams(location.hash.slice(1));
  const year = Number(params.get("year"));
  return {
    year: years.includes(year) ? year : 2020,
    page: Number(params.get("page")) || 0,
    query: params.get("q") || "",
    item: Number(params.get("item")) || 0,
    part: Number(params.get("part")) || 0,
    group: Number(params.get("group")) || 0,
    view: params.get("view")
  };
}

function loadYear(year) {
  if (!loaded.has(year)) {
    loaded.set(year, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = year + ".js";
      script.onload = () => {
        const data = window.epcYears[year];
        if (!data) {
          reject(new Error("Unable to read the catalog for " + year));
          return;
        }
        data.chapterMap = new Map(data.chapters);
        data.pageMap = new Map(data.pages);
        data.pagesByChapter = new Map();
        data.children = new Map();
        data.figures = new Map();
        data.groupChapters = new Map();
        for (const [id, page] of data.pages) {
          if (epcDetails.diagramOrder[id]) page[2] = epcDetails.diagramOrder[id];
          if (!data.pagesByChapter.has(page[0])) data.pagesByChapter.set(page[0], []);
          data.pagesByChapter.get(page[0]).push([id, page]);
          const [, group, , figure] = page[6].split("|");
          if (!/^\d+$/.test(group || "") || !/^\d+$/.test(figure || "")) continue;
          const code = figureCode(group, figure);
          if (!data.figures.has(code)) data.figures.set(code, []);
          data.figures.get(code).push(id);
          let root = page[0];
          while (data.chapterMap.get(root)?.[2]) root = data.chapterMap.get(root)[2];
          const groupId = Number(group);
          if (!data.groupChapters.has(groupId)) data.groupChapters.set(groupId, new Set());
          data.groupChapters.get(groupId).add(root);
        }
        for (const [id, chapter] of data.chapters) {
          if (!data.children.has(chapter[2])) data.children.set(chapter[2], []);
          data.children.get(chapter[2]).push([id, chapter]);
        }
        resolve(data);
      };
      script.onerror = () => reject(new Error("Unable to load " + year + ".js"));
      document.head.append(script);
    }));
  }
  return loaded.get(year);
}

function figureCode(group, figure) {
  return `${Number(group)}-${Number(figure)}`;
}

function groupUrl(year, group) {
  return `${url(year)}&group=${Number(group)}`;
}

const groupReference = /\bSEE\s+GROUP\s+(\d{1,3})(?:\s*-\s*(\d+)|\s*,?\s+ILLUSTRATION\s+(\d+))?/gi;

function linkedDescription(description, data, year) {
  let end = 0;
  let result = "";
  for (const match of description.matchAll(groupReference)) {
    const [text, group, first, second] = match;
    const figure = first || second;
    const pages = figure ? data.figures.get(figureCode(group, figure)) : [];
    const href = pages?.length === 1 ? url(year, pages[0])
      : data.groupChapters.has(Number(group)) && (!figure || pages?.length) ? groupUrl(year, group) : "";
    result += escapeHtml(description.slice(end, match.index));
    result += href ? `<a class="catalog-link" href="${href}">${escapeHtml(text)}</a>` : escapeHtml(text);
    end = match.index + text.length;
  }
  return result + escapeHtml(description.slice(end));
}

function inMarket(codes) {
  return !market || !codes.length || codes.includes(market);
}

function availablePlacements(pageId, page) {
  if (!matchesVehicleRules) return page[5].filter(item => inMarket(item[5])).map(item => [item, true]);
  if (vehiclePlacements.has(pageId)) return vehiclePlacements.get(pageId);
  const section = epcDetails.rules.chapter[page[0]]?.[0];
  const pageRule = epcDetails.rules.page[pageId]?.[0];
  const scope = [matchesVehicleRules(section), matchesVehicleRules(pageRule)];
  const rows = [];
  if (!scope.includes(false)) {
    for (const item of page[5]) {
      const diagram = epcDetails.rules.image[item[2]]?.[0];
      const result = [...scope, matchesVehicleRules(diagram), matchesVehicleRules(item[7])];
      if (!result.includes(false)) rows.push([item, !result.includes(null)]);
    }
  }
  vehiclePlacements.set(pageId, rows);
  return rows;
}

function groupPlacements(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const [[id, position, image, number, qty, markets, text, , , replacements, notServiced, discontinued]] = entry;
    const part = epcDetails.items[id];
    const key = part ? JSON.stringify([part, position, image, number, qty, markets, text, replacements,
      notServiced, discontinued, epcDetails.links.part_item_id[id] || []]) : id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()];
}

function pageVisible(id, page) {
  return matchesVehicleRules ? availablePlacements(id, page).length > 0 : inMarket(page[3]);
}

function updateVehicleStatus() {
  const fields = vehicle ? {...vehicle.fields} : null;
  if (fields && market) fields.BUSREG = [market];
  if (fields && vinSeries.value) fields.Z = [vinSeries.value];
  if (fields && vinTransmission.value) fields.T = [vinTransmission.value];
  matchesVehicleRules = fields
    ? fitmentMatcher(fields, epcVinIndex.salesCodes, {gearboxOnly: !vehicle.factory})
    : null;
  updateVinInformation(vehicle);
  vehiclePlacements.clear();
  vinInput.removeAttribute("aria-invalid");
  vinStatus.classList.remove("error");
  clearVin.hidden = !vehicle;
  marketSelect.disabled = Boolean(vehicle?.fields.BUSREG?.length);
  document.querySelector("#vin-series-label").hidden = Boolean(vehicle?.fields.Z?.length);
  document.querySelector("#vin-transmission-label").hidden = Boolean(vehicle?.fields.T?.length);
  document.querySelector("#vin-options").hidden = !vehicle || Boolean(vehicle.fields.Z?.length && vehicle.fields.T?.length);
  if (!vehicle) {
    vinStatus.textContent = "";
    return;
  }
  const transmission = fields.T?.filter(code => gearboxCodes.includes(code));
  const known = [["Z", fields.Z], ["BUSREG", fields.BUSREG], ["T", transmission]].flatMap(([field, values]) =>
    (values || []).map(value => fitmentValue(field, value, vehicle.year)));
  const title = `${vehicle.year} Fiat 124 Spider${known.length ? ` · ${known.join(" · ")}` : ""}`;
  vinStatus.textContent = `${title}. ${vehicle.factory ? "EPC factory record found." : "VIN decoding only. Select known options to narrow the results."} Unconfirmed matches stay visible.`;
}

function updateVinInformation(current) {
  const panel = document.querySelector("#vin-build");
  const contents = document.querySelector("#vin-equipment");
  const build = current?.build;
  panel.hidden = !build;
  if (!build) {
    panel.open = false;
    contents.replaceChildren();
    return;
  }
  const {date, optionCodes} = build;
  const differential = current.fields.T?.includes("DSA") ? "Limited-slip differential" : "";
  const metadata = [date && `Build date ${date}`, differential].filter(Boolean).join(" · ");
  const labels = epcVinIndex.optionLabels?.[current.year] || {};
  contents.innerHTML = `${metadata ? `<p>${escapeHtml(metadata)}</p>` : ""}
    <h2>Factory Sales Codes</h2>
    ${displayTable(["Code", "Description"], optionCodes.map(code =>
      [escapeHtml(code), escapeHtml(labels[code] || "—")]))}`;
}

function chapterName(chapter) {
  return chapter[0] + " · " + chapter[1];
}

function childrenOf(data, chapterId) {
  return data.children.get(chapterId) || [];
}

function pagesOf(data, chapterId) {
  return (data.pagesByChapter.get(chapterId) || []).filter(([id, page]) => pageVisible(id, page));
}

function showSidebar(data, year, current) {
  const activeChapter = current ? data.pageMap.get(current)?.[0] : 0;
  const chapterNode = ([id, chapter]) => {
    const children = childrenOf(data, id).map(chapterNode).join("");
    const pages = pagesOf(data, id).map(([pid, page]) =>
      `<a class="side-link" href="${url(year, pid)}" ${pid === current ? 'aria-current="page"' : ""}>${escapeHtml(page[1])}</a>`
    ).join("");
    if (!children && !pages) return "";
    const open = activeChapter === id || data.chapterMap.get(activeChapter)?.[2] === id;
    return `<details ${open ? "open" : ""}><summary><i class="chevron" aria-hidden="true"></i>${escapeHtml(chapterName(chapter))}</summary>${pages}${children}</details>`;
  };
  sidebar.innerHTML = `<a class="side-home" href="${url(year)}"><span aria-hidden="true">←</span> Contents · ${year}</a>`
    + childrenOf(data, 0).map(chapterNode).join("");
  if (sidebar.clientHeight) sidebar.querySelector('[aria-current="page"]')?.scrollIntoView({block: "nearest"});
}

function chapterThumbnail(id) {
  const path = epcDetails.chapterImages[id];
  return path ? `<img class="chapter-thumbnail" src="${escapeHtml(path)}" width="56" height="40" loading="lazy" alt="">` : "";
}

function showOverview(data, year, group) {
  const documentIds = visibleDocumentIds(epcDetails.links.catalog_id[epcDetails.catalogs[year]] || []);
  const linked = data.groupChapters.get(group);
  const pageCount = data.pages.filter(([id, page]) => pageVisible(id, page)).length;
  const pageLinks = pages => pages.map(([pid, page]) =>
    `<a href="${url(year, pid)}">${escapeHtml(page[1])}</a>`
  ).join("");
  const sections = childrenOf(data, 0).flatMap(([id, chapter]) => {
    const pages = pagesOf(data, id);
    const children = childrenOf(data, id).map(([childId, child]) => ({
      id: childId, title: chapterName(child),
      pages: pagesOf(data, childId)
    })).filter(child => child.pages.length);
    const count = pages.length + children.reduce((total, child) => total + child.pages.length, 0);
    if (!count) return [];
    const links = pageLinks(pages) + children.map(child =>
      `<h3 class="chapter-subtitle">${chapterThumbnail(child.id)}${escapeHtml(child.title)}</h3>${pageLinks(child.pages)}`
    ).join("");
    return `<details class="chapter"${linked?.has(id) ? " open data-linked-group" : ""}>
      <summary class="chapter-toggle">${chapterThumbnail(id)}<span class="chapter-code">${escapeHtml(chapter[0])}</span>
        <span class="chapter-title">${escapeHtml(chapter[1])}</span>
        <span class="chapter-count" aria-label="Pages: ${count}">${count}</span>
        <i class="chevron" aria-hidden="true"></i>
      </summary>
      <div class="chapter-pages">${links}</div>
    </details>`;
  });
  const middle = Math.ceil(sections.length / 2);
  main.innerHTML = `<section class="overview">
      <div>
        <img class="wordmark" src="brand/124-spider.png" width="1024" height="256" alt="124 Spider">
        <h1>${year} Model Year</h1>
        <p class="overview-meta">Fiat 124 Spider (BA) · ${pageCount} pages</p>
      </div>
      <img class="overview-image" src="brand/roadster.png" width="1200" height="800" alt="">
    </section>
    <section class="index-panel">
      <div class="panel-heading"><h2>Catalog Sections</h2></div>
      <div class="index-list">
        <div class="index-column">${sections.slice(0, middle).join("")}</div>
        <div class="index-column">${sections.slice(middle).join("")}</div>
      </div>
    </section>
    ${documentIds.length ? `<section class="documents">
      <div class="panel-heading"><h2>EPC Documents</h2></div>
      <ul>${documentFiles(documentIds).map(ids => `<li>${documentFileLink(ids)}</li>`).join("")}</ul>
    </section>` : ""}`;
}

function partUrl(year, partId, page = "", item = "") {
  return `${url(year, page, "", item)}&part=${partId}`;
}

function referenceUrl(year, view) {
  return `${url(year)}&view=${view}`;
}

function documentFiles(ids) {
  const byPath = new Map();
  for (const id of ids) {
    const {path} = epcDetails.documents[id];
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push(id);
  }
  return [...byPath.values()];
}

function documentLink(id, title = epcDetails.documents[id].title) {
  const {path} = epcDetails.documents[id];
  return `<a class="catalog-link" href="${escapeHtml(path)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`;
}

function documentFileLink(ids) {
  const titles = [...new Set(ids.map(id => epcDetails.documents[id].title))];
  const labels = titles.map(title => title.split(" - "));
  const suffix = labels[0][1];
  const title = titles.length > 1 && suffix && labels.every(label => label.length === 2 && label[1] === suffix)
    ? `${labels.map(([label]) => label).sort().join(" · ")} - ${suffix}`
    : titles.join(" · ");
  return documentLink(ids[0], title);
}

function documentMatcher() {
  return matchesVehicleRules || (market ? fitmentMatcher({BUSREG: [market]}) : null);
}

function documentVisible(id, match) {
  return !match || epcDetails.documents[id].rules.every(rule => match(rule) !== false);
}

function visibleDocumentIds(links) {
  const match = documentMatcher();
  return [...new Set(links.filter(([id, region]) =>
    inMarket(region ? [region] : []) && documentVisible(id, match)).map(([id]) => id))];
}

function partDocumentIds(partId, itemId) {
  return visibleDocumentIds([...(epcDetails.links.part_id[partId] || []), ...(epcDetails.links.part_item_id[itemId] || [])]);
}

function ruleDetails(title, rules, year) {
  const groups = rules.filter(([scope, value]) => value && !/\bset$/i.test(scope))
    .map(([scope, value]) => [scope, vehicleConditions(value, year)]);
  return conditionDetails(title, groups, year);
}

function conditionDetails(title, groups, year) {
  const multiple = groups.filter(([, conditions]) => conditions?.length).length > 1;
  const summary = groups.map(([scope, conditions]) => {
    if (!conditions) return '<p class="line-note">Check the EPC applicability for this entry.</p>';
    if (!conditions.length) return "";
    return `<div class="fitment-group">${multiple ? `<span class="fitment-scope">${escapeHtml(scope)}</span>` : ""}
      <ul class="fitment-conditions">${conditions.map(condition => `<li>${fitmentCondition(condition, year)}</li>`).join("")}</ul></div>`;
  }).join("");
  return summary ? `<details class="fitment"><summary><i class="chevron" aria-hidden="true"></i>${escapeHtml(title)}</summary>${summary}</details>` : "";
}

function displayTable(headers, rows) {
  return `<div class="table-scroll"><table><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function partLink(year, id) {
  const part = epcDetails.parts[id];
  return part ? `<a class="catalog-link part-number" href="${partUrl(year, id)}">${escapeHtml(part.number)}</a>` : "—";
}

function replacementGroup(relation, index) {
  const [context, old, , type, , , , , , , set, operand] = relation;
  return set ? JSON.stringify([context, old, type, set, operand]) : index;
}

function partRelationships(part, year) {
  if (!part.relations?.length) return "";
  const groups = new Map(part.relations.map(index =>
    [replacementGroup(epcDetails.relations[index], index), []]));
  epcDetails.relations.forEach((relation, index) => groups.get(replacementGroup(relation, index))?.push(relation));
  const headers = ["Previous or source part", "Replacement or alternate", "Relationship", "Qty.", "EPC notes"];
  const sections = [];
  let singles = [];
  const flush = () => {
    if (singles.length) sections.push(displayTable(headers, singles));
    singles = [];
  };
  for (const group of groups.values()) {
    const [, old] = group[0];
    const grouped = new Set(group.map(relation => relation[2]).filter(Boolean)).size > 1;
    const common = grouped && group.every(relation => relation[8] === group[0][8]) ? group[0][8] : "";
    const rows = group.map(([context, previous, next, type, quantity, forward, date, book, description, rule]) => {
      const kind = type === "SUPERCEDED" ? "Supersession" : type === "ALTERNATE" ? "Alternate" : type;
      const direction = forward === 1 ? "One way" : forward === 0 ? "Two way" : "";
      const notes = [description !== common && description, date && `Effective ${date}`, book && `Price book: ${book}`].filter(Boolean);
      if (context !== previous && context !== next) notes.push(`Listed in EPC under ${epcDetails.parts[context].number}`);
      return [partLink(year, previous), partLink(year, next), escapeHtml([kind, direction].filter(Boolean).join(" · ")),
        escapeHtml(quantity || "—"), `<span class="line-note">${escapeHtml(notes.join("\n"))}</span>${ruleDetails("Fitment", [["Relationship", rule]], year)}`];
    });
    if (!grouped) {
      singles.push(...rows);
      continue;
    }
    flush();
    sections.push(`<section class="replacement-set"><h3>Replacement set for ${partLink(year, old)}</h3>
      ${common ? `<p class="replacement-note">${escapeHtml(common.trim())}</p>` : ""}${displayTable(headers.slice(1), rows.map(row => row.slice(1)))}</section>`);
  }
  flush();
  return sections.join("");
}

async function showPart(state, ticket) {
  const {year, part: id} = state;
  const catalogs = await Promise.all(years.map(loadYear));
  if (ticket !== renderId) return;
  const part = epcDetails.parts[id];
  const origin = catalogs[years.indexOf(year)].pageMap.get(state.page);
  const originItem = origin?.[5].find(item => item[0] === state.item && epcDetails.items[item[0]] === id);
  const attachments = partDocumentIds(id, originItem?.[0]);
  const relationships = partRelationships(part, year);
  const placements = [];
  for (const [index, catalog] of catalogs.entries()) {
    const modelYear = years[index];
    if (vehicle && modelYear !== vehicle.year) continue;
    for (const [pageId, page] of catalog.pages) {
      if (!pageVisible(pageId, page)) continue;
      const entries = availablePlacements(pageId, page).filter(([item]) => epcDetails.items[item[0]] === id);
      if (!entries.length) continue;
      const chapter = catalog.chapterMap.get(page[0]);
      placements.push([modelYear, `<a class="catalog-link" href="${url(modelYear, pageId, "", entries[0][0][0])}">${escapeHtml(page[1])}</a>
        <span class="line-note">${escapeHtml(chapterName(chapter))}</span>`, groupPlacements(entries).length]);
    }
  }
  const description = [part.description, part.make, part.notServiced && "Not serviced separately", part.discontinued && "Discontinued"].filter(Boolean);
  main.innerHTML = `<nav class="crumbs"><span><a href="${url(year)}">Fiat 124 Spider · ${year}</a></span>
      ${origin ? `<span><a href="${url(year, state.page, "", state.item)}">${escapeHtml(origin[1])}</a></span>` : ""}Part Details</nav>
    <h1>${escapeHtml(part.number)}</h1><p class="page-key">${escapeHtml(description.join(" · "))}</p>
    ${attachments.length ? `<section class="catalog-panel"><h2>Part Documents</h2>
      <ul class="catalog-links">${attachments.map(aid => `<li>${documentLink(aid)} <span>${escapeHtml(epcDetails.documents[aid].group)}</span></li>`).join("")}</ul></section>` : ""}
    ${relationships ? `<section class="catalog-panel"><h2>Supersessions and Alternates</h2>
      ${relationships}</section>` : ""}
    <section class="catalog-panel"><h2>Where Used</h2>
      ${placements.length ? displayTable(["Model year", "Diagram", "Positions"], placements) : '<p>No diagram positions for the selected market in this catalog.</p>'}</section>
    ${part.prices?.length ? `<details class="catalog-panel"><summary><i class="chevron" aria-hidden="true"></i>Historical Prices</summary>
      <p>Recorded in the September 2020 EPC release.</p>
      ${displayTable(["Price book", "Type", "Amount", "Effective date"], part.prices.map(([book, currency, type, value, date]) =>
        [escapeHtml(book), escapeHtml(type.replaceAll("_", " ")), escapeHtml(`${currency} ${value}`), escapeHtml(date || "—")]))}</details>` : ""}`;
}

function showDocuments(year) {
  const groups = new Map();
  const relatedParts = new Map();
  const match = documentMatcher();
  for (const [id, links] of Object.entries(epcDetails.links.part_id)) {
    for (const aid of visibleDocumentIds(links)) {
      if (!relatedParts.has(aid)) relatedParts.set(aid, new Set());
      relatedParts.get(aid).add(id);
    }
  }
  for (const [id, document] of Object.entries(epcDetails.documents)) {
    if (!documentVisible(id, match)) continue;
    if (!groups.has(document.group)) groups.set(document.group, []);
    groups.get(document.group).push(Number(id));
  }
  main.innerHTML = `<h1>EPC Document Library</h1><p class="page-key">US English · September 2020</p>
    ${[...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "en-US")).map(([group, ids]) =>
      `<section class="catalog-panel"><h2>${escapeHtml(group)}</h2><ul class="catalog-links">${documentFiles(ids).map(fileIds => {
        const parts = new Set(fileIds.flatMap(id => [...(relatedParts.get(id) || [])]));
        const rules = fileIds.flatMap(id => {
          const {title, rules} = epcDetails.documents[id];
          return rules.map(rule => [fileIds.length > 1 ? title.split(" - ")[0] : "Document", rule]);
        });
        return `<li>${documentFileLink(fileIds)}${parts.size ? `<div class="related-parts">${[...parts].map(part => partLink(year, part)).join(" · ")}</div>` : ""}
          ${ruleDetails("EPC conditions", rules, year)}</li>`;
      }).join("")}</ul></section>`).join("")}`;
}

function showVehicleCodes(year) {
  const {options, vin} = epcDetails.vehicle[year];
  const yearMismatch = vin.some(([, name, , value]) => name === "Model Year" && !value.includes(String(year)));
  main.innerHTML = `<h1>${year} Vehicle Codes</h1><p class="page-key">Fiat 124 Spider (BA) · EPC reference</p>
    <section class="catalog-panel"><h2>Equipment and Fitment Codes</h2>
      ${displayTable(["Group", "Code", "Description"], options.map(([group, name, code, description]) => [name, code,
        (group === "Z" && fiatTrims[code]) || epcResources.filters[`${group}|${code}`] || (description === "NO DESCRIPTION AVAILABLE" ? "" : description) || "—"].map(escapeHtml)))}</section>
    <section class="catalog-panel"><h2>VIN Code Reference</h2>
      ${yearMismatch ? '<p class="notice warning">The EPC model-year entry disagrees with this catalog year. The source values are shown below.</p>' : ""}
      ${vin.length ? displayTable(["Position", "Attribute", "Code", "Meaning"], vin.map(([positions, name, code, description]) =>
        [positions.join(", "), name, code, description].map(escapeHtml))) : '<p>EPC has no dedicated VIN code records for this model year.</p>'}</section>`;
}

const illustrationPartNames = {
  "VALVE STEM|BLACK, CAP KIT": "Black Valve Stem Cap Kit",
  "FRAME, LICENSE PLATE KIT": "License Plate Frame Kit",
  "FLOOR - FRONT, MAT KIT": "Front Floor Mat Kit",
  "CARGO-INTERIOR, NET KIT": "Interior Cargo Net Kit",
  "VEHICLE-FULL, COVER KIT": "Full Vehicle Cover Kit",
  "NONE|FIAT, EMBLEM": "Fiat Emblem",
  "NONE, LICENSE PLATE KIT": "License Plate Kit"
};

function illustrationTitles(images, items) {
  const partsByImage = new Map(images.map(image => [image, new Set()]));
  for (const item of items) {
    const name = item[6][0].trim();
    if (name) {
      const title = illustrationPartNames[name] || name.toLowerCase().replaceAll(",", "")
        .replace(/\b(?!and\b)[a-z]/g, letter => letter.toUpperCase());
      partsByImage.get(item[2]).add(title);
    }
  }
  return images.map((image, index) => [...partsByImage.get(image)].join(" / ") || `Diagram ${index + 1}`);
}

function partRow(entries, data, year, pageId, images, showCallouts) {
  const [[id, position, image, number, qty, markets, text, , , superseded, notServiced, discontinued]] =
    entries.find(([item]) => item[0] === selectedItem) || entries[0];
  const diagram = images.indexOf(image);
  const confirmed = entries.some(([, matches]) => matches);
  const conditions = placementConditions(entries.map(([item]) => item[7]), year);
  const [name, use, side] = text;
  const partId = epcDetails.items[id];
  const attachments = partDocumentIds(partId, id);
  const status = [notServiced && "Not serviced separately", discontinued && "Discontinued"].filter(Boolean);
  const highlights = [...new Set([use, side, ...status].filter(Boolean))];
  if (superseded.length) highlights.push("Superseded by " + superseded.join(", "));
  return `<tr data-item="${id}" data-diagram="${diagram}" data-position="${escapeHtml(position)}" class="${selectedItem === id || (diagram === selectedImage && selectedCallout && position === selectedCallout) ? "selected" : ""}">
    ${showCallouts ? `<td>${position ? `<button type="button" class="table-callout" data-diagram="${diagram}" data-position="${escapeHtml(position)}" aria-label="Callout ${escapeHtml(position)}${images.length > 1 ? `, image ${diagram + 1}` : ""}">${escapeHtml(position)}</button>` : "—"}</td>` : ""}
    <td>${partId ? `<a class="catalog-link part-number" href="${partUrl(year, partId, pageId, id)}">${escapeHtml(number || epcDetails.parts[partId].number)}</a>` : `<span class="part-number">${escapeHtml(number || "—")}</span>`}</td>
    <td class="part-description">${linkedDescription(name, data, year)}${highlights.map(line => `<span class="line-note">${linkedDescription(line, data, year)}</span>`).join("")}${attachments.map(aid => `<div>${documentLink(aid)}</div>`).join("")}${confirmed ? "" : '<span class="line-note fitment-check">Check fitment</span>'}${conditionDetails("Fitment", [["Position", conditions]], year)}</td>
    <td>${escapeHtml(qty || "—")}</td>
    <td>${escapeHtml(markets.map(code => marketNames[code] || code).join(", ") || "—")}</td>
  </tr>`;
}

function showPage(data, year, id, page) {
  const [chapterId, name, images, , notes, items, key] = page;
  const titles = images.length > 1 ? illustrationTitles(images, items) : ["Diagram"];
  const chapter = data.chapterMap.get(chapterId);
  const parent = data.chapterMap.get(chapter[2]);
  const rows = availablePlacements(id, page);
  const groups = groupPlacements(rows);
  const groupsByImage = new Map(images.map(image => [image, []]));
  for (const entries of groups) {
    const [[item]] = entries;
    groupsByImage.get(item[2]).push(entries);
  }
  const tabs = images.map((_, index) => index).filter(index => !vehicle || groupsByImage.get(images[index]).length);
  if (tabs.length && !tabs.includes(selectedImage)) selectedImage = tabs[0];
  if (selectedItem && !rows.some(([item]) => item[0] === selectedItem)) {
    selectedItem = 0;
    selectedCallout = "";
  }
  const showCallouts = items.some(item => item[1]);
  const columnCount = showCallouts ? 5 : 4;
  const imageButton = (index, compact = false) => {
    const number = index + 1;
    const label = escapeHtml(`Image ${number}: ${titles[index]}`);
    return `<button class="diagram-tab" type="button" data-image="${index}" aria-pressed="${index === selectedImage}"
      aria-label="${label}"${compact ? ` title="${label}"` : ""}>${compact ? number : escapeHtml(`${number} · ${titles[index]}`)}</button>`;
  };
  const partsTable = images.map((image, index) => {
    const imageGroups = groupsByImage.get(image);
    if (!imageGroups.length) return "";
    return `<tbody>${images.length > 1 ? `<tr class="illustration-heading">
      <th scope="rowgroup" colspan="${columnCount}">${imageButton(index)}</th></tr>` : ""}
      ${imageGroups.map(entries => partRow(entries, data, year, id, images, showCallouts)).join("")}</tbody>`;
  }).join("");
  const [file, width, height, markers] = epcResources.images[images[selectedImage]];
  const positions = new Set(rows.filter(([item]) => item[2] === images[selectedImage]).map(([item]) => item[1]));
  const diagramLabel = escapeHtml(name);
  const fitment = [["Section", epcDetails.rules.chapter[chapterId]?.[0]],
    ["Section set", epcDetails.rules.chapter[chapterId]?.[1]], ["Page", epcDetails.rules.page[id]?.[0]],
    ["Page set", epcDetails.rules.page[id]?.[1]], ["Diagram", epcDetails.rules.image[images[selectedImage]]?.[0]],
    ["Diagram set", epcDetails.rules.image[images[selectedImage]]?.[1]]];
  const sectionDocuments = visibleDocumentIds(epcDetails.links.chapter_id[chapterId] || []);
  main.innerHTML = `<nav class="crumbs"><span><a href="${url(year)}">Fiat 124 Spider · ${year}</a></span>
      ${parent ? `<span>${escapeHtml(chapterName(parent))}</span>` : ""}${escapeHtml(chapterName(chapter))}</nav>
    <h1>${diagramLabel}</h1><p class="page-key">${escapeHtml(key)}</p>
    ${!vehicle && !inMarket(page[3]) ? '<p class="notice warning">This diagram is unavailable for the selected market.</p>' : ""}
    ${vehicle && !rows.length ? '<p class="notice warning">No positions on this page match the active VIN filter.</p>' : ""}
    ${notes.map(note => `<p class="notice">${escapeHtml(note)}</p>`).join("")}
    ${sectionDocuments.length ? `<ul class="catalog-links">${sectionDocuments
      .map(aid => `<li>${documentLink(aid)}</li>`).join("")}</ul>` : ""}
    ${ruleDetails("Page and Diagram Fitment", fitment, year)}
    <div class="page">
      <figure class="schematic">
        <div class="schematic-top">
          <h2>${escapeHtml(titles[selectedImage])}</h2>
          <a class="text-action" href="images/${file}" target="_blank" rel="noopener">Original <span aria-hidden="true">↗</span></a>
        </div>
        ${tabs.length > 1 ? `<div class="diagram-tabs" aria-label="Illustrations">${tabs.map(index => imageButton(index, true)).join("")}</div>` : ""}
        <div class="drawing" style="width:min(100%,${Math.round(62 * width / height)}vh)">
          <img src="images/${file}" width="${width}" height="${height}" alt="${diagramLabel}">
          ${markers.filter(([position]) => positions.has(position)).map(([position, x, y]) =>
            `<button class="marker${position === selectedCallout ? " selected" : ""}" data-position="${escapeHtml(position)}" type="button"
              aria-label="Callout ${escapeHtml(position)}" data-diagram="${selectedImage}" title="${escapeHtml(position)}"
              style="left:${100 * x / width}%;top:${100 * y / height}%"></button>`
          ).join("")}
        </div>
      </figure>
      <section class="parts">
        <div class="tools"><span>${groups.length} positions${tabs.length > 1 ? " · All illustrations" : ""}</span>
          <button class="button outline" type="button" id="clear-position" ${selectedCallout || selectedItem ? "" : "hidden"}>Clear highlight</button></div>
        <table class="parts-table${showCallouts ? " has-callouts" : ""}" aria-label="Parts">
          <colgroup>${showCallouts ? '<col class="parts-col-callout">' : ""}<col class="parts-col-number"><col>
            <col class="parts-col-qty"><col class="parts-col-market"></colgroup>
          <thead><tr>${showCallouts ? '<th scope="col">Callout</th>' : ""}<th scope="col">Part Number</th>
            <th scope="col">Description</th><th scope="col">Qty.</th><th scope="col">Market</th></tr></thead>
          ${partsTable || `<tbody><tr><td colspan="${columnCount}">No positions match the current filters.</td></tr></tbody>`}</table>
      </section>
    </div>`;
  function highlight(position, diagram, scroll) {
    selectedItem = 0;
    selectedCallout = position;
    if (diagram !== selectedImage) {
      selectedImage = diagram;
      showPage(data, year, id, page);
    }
    const targets = main.querySelectorAll(".marker, tr[data-position]");
    for (const element of targets) {
      element.classList.toggle("selected", !!position && element.dataset.position === position && Number(element.dataset.diagram) === diagram);
    }
    main.querySelector("#clear-position").hidden = !position;
    if (scroll) main.querySelector("tr.selected")?.scrollIntoView({block: "nearest"});
  }
  main.querySelector("#clear-position").addEventListener("click", () => highlight("", selectedImage, false));
  for (const button of main.querySelectorAll("button[data-position]")) {
    button.addEventListener("click", () => highlight(button.dataset.position, Number(button.dataset.diagram), button.classList.contains("marker")));
  }

  for (const button of main.querySelectorAll("button[data-image]")) {
    button.addEventListener("click", () => {
      const fromTable = button.closest("tbody");
      selectedImage = Number(button.dataset.image);
      selectedCallout = "";
      selectedItem = 0;
      showPage(data, year, id, page);
      if (fromTable) main.querySelector(".schematic").scrollIntoView({block: "nearest"});
      const control = main.querySelector(`.diagram-tabs [data-image="${selectedImage}"]`)
        || main.querySelector(`.illustration-heading [data-image="${selectedImage}"]`);
      control?.focus({preventScroll: true});
    });
  }
}

function searchNumber(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function showSearch(state, ticket) {
  const {query, year} = state;
  const catalogYears = await Promise.all(years.map(loadYear));
  if (ticket !== renderId) return;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const textQueries = searchQueries(query);
  const figureQuery = query.match(/^(\d{1,3})\s*[-–]\s*(\d+)$/);
  const matchDocument = documentMatcher();
  const numberToken = searchNumber(query);
  const hits = [];
  const documentHits = Object.entries(epcDetails.documents).filter(([documentId, document]) =>
    documentVisible(documentId, matchDocument) && (tokens.every(token => document.title.toLowerCase().includes(token)) ||
    (numberToken.length > 3 && /\d/.test(numberToken) && searchNumber(document.title).includes(numberToken))));
  const documentIds = new Set(documentHits.map(([id]) => Number(id)));
  const seenParts = new Set();
  const placedParts = new Set();
  for (const [index, catalog] of catalogYears.entries()) {
    const hitYear = years[index];
    if (vehicle && hitYear !== vehicle.year) continue;
    const figurePages = figureQuery && catalog.figures.get(figureCode(figureQuery[1], figureQuery[2]));
    for (const [id, page] of catalog.pages) {
      if (figurePages?.includes(id) && pageVisible(id, page)) {
        hits.push({hitYear, id, page, matched: [], exact: true});
        continue;
      }
      if (vehicle) for (const item of page[5]) placedParts.add(String(epcDetails.items[item[0]]));
      if (!pageVisible(id, page)) continue;
      const chapter = catalog.chapterMap.get(page[0]);
      const context = page[1] + " " + chapter[1] + " " + page[6];
      const matchesText = value => matchesSearchText(value, textQueries);
      const matched = [];
      let exact = false;
      for (const [item] of availablePlacements(id, page)) {
        const numbers = [item[3], ...item[9]].map(searchNumber);
        const isNumber = numberToken.length > 2 && /\d/.test(numberToken)
          && numbers.some(number => number && number.includes(numberToken));
        exact ||= isNumber && numbers.includes(numberToken);
        const hasDocument = documentIds.size && partDocumentIds(epcDetails.items[item[0]], item[0]).some(id => documentIds.has(id));
        if (isNumber || hasDocument || matchesText(item[6].join(" "))) matched.push(item);
        if (vehicle && isNumber) seenParts.add(String(epcDetails.items[item[0]]));
      }
      if (matched.length || matchesText(context)) hits.push({hitYear, id, page, matched, exact});
    }
  }
  const partHits = numberToken ? Object.entries(epcDetails.parts).filter(([id, part]) =>
    (!vehicle || !placedParts.has(id) || seenParts.has(id)) && searchNumber(part.number) === numberToken) : [];
  hits.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.hitYear === year) - Number(a.hitYear === year)
    || Number(!!b.matched.length) - Number(!!a.matched.length));
  main.innerHTML = `<div class="search-heading"><h1>Search Results</h1>
    <p>“${escapeHtml(query)}” · ${hits.length} ${hits.length === 1 ? "page" : "pages"}${hits.length > 250 ? " (first 250 shown)" : ""}</p></div>
    ${partHits.length ? `<section class="catalog-panel"><h2>Part Details</h2><ul class="catalog-links">${partHits.map(([id, part]) =>
      `<li>${partLink(year, id)} <span>${escapeHtml(part.description)}</span>${vehicle && !seenParts.has(id) ? ' <span class="fitment-check">Check fitment</span>' : ""}</li>`).join("")}</ul></section>` : ""}
    ${documentHits.length ? `<section class="catalog-panel"><h2>Documents</h2><ul class="catalog-links">${documentFiles(documentIds).map(ids =>
      `<li>${documentFileLink(ids)}</li>`).join("")}</ul></section>` : ""}
    ${hits.length ? `<div class="results">${hits.slice(0, 250).map(({hitYear, id, page, matched}) => {
      const examples = [...new Set(matched.map(item => [item[3], item[6][0]].filter(Boolean).join(" · ")))];
      return `<a class="result" href="${url(hitYear, id, "", matched[0]?.[0])}">
        <span class="result-year">${hitYear}</span>
        <div><strong>${escapeHtml(page[1])}</strong>
        ${examples.slice(0, 3).map(example => `<p>${escapeHtml(example)}</p>`).join("")}
        ${examples.length > 3 ? `<p>${examples.length - 3} more</p>` : ""}</div>
        <i class="chevron" aria-hidden="true"></i></a>`;
    }).join("")}</div>` : (partHits.length || documentHits.length ? "" : '<p class="notice">No results found.</p>')}`;
}

function setSidebar(open) {
  layout.classList.toggle("sidebar-open", open);
  sectionToggle.setAttribute("aria-expanded", String(open));
}

async function render() {
  const ticket = ++renderId;
  const state = route();
  const {year, query, view, group} = state;
  if (vehicle && year !== vehicle.year) {
    location.hash = query ? url(vehicle.year, "", query) : view ? referenceUrl(vehicle.year, view)
      : group ? groupUrl(vehicle.year, group) : url(vehicle.year);
    return;
  }
  document.querySelector("#vehicle-codes").href = referenceUrl(year, "vehicle");
  document.querySelector("#document-library").href = referenceUrl(year, "documents");
  document.querySelector("#brand").href = url(year);
  document.querySelector("#years").innerHTML = (vehicle ? [vehicle.year] : years).map(option =>
    `<a class="nav-item" href="${view === "vehicle" || view === "documents" ? referenceUrl(option, view) : url(option)}" ${option === year ? 'aria-current="true"' : ""}>${option}</a>`
  ).join("");
  queryInput.value = query;
  main.setAttribute("aria-busy", "true");
  try {
    const data = await loadYear(year);
    if (ticket !== renderId) return;
    const hasPart = !query && Boolean(epcDetails.parts[state.part]);
    const hasPage = !query && !hasPart && !view && data.pageMap.has(state.page);
    layout.classList.toggle("with-sidebar", hasPage);
    setSidebar(false);
    if (query) {
      await showSearch(state, ticket);
    } else if (hasPart) {
      await showPart(state, ticket);
    } else if (view === "documents") {
      showDocuments(year);
    } else if (view === "vehicle") {
      showVehicleCodes(year);
    } else if (hasPage) {
      showSidebar(data, year, state.page);
      const page = data.pageMap.get(state.page);
      const item = page[5].find(row => row[0] === state.item);
      selectedImage = item ? Math.max(0, page[2].indexOf(item[2])) : 0;
      selectedCallout = item?.[1] || "";
      selectedItem = item?.[0] || 0;
      showPage(data, year, state.page, page);
    } else {
      showOverview(data, year, group);
    }
  } catch (error) {
    if (ticket === renderId) main.textContent = error.message + ". Extract the entire archive and open index.html.";
  } finally {
    if (ticket === renderId) {
      main.removeAttribute("aria-busy");
      window.scrollTo(0, 0);
      if (group) main.querySelector("[data-linked-group]")?.scrollIntoView({block: "start"});
    }
  }
}

search.addEventListener("submit", event => {
  event.preventDefault();
  const query = queryInput.value.trim();
  const target = url(route().year, "", query);
  if (target !== location.hash) location.hash = target;
});
marketSelect.addEventListener("change", () => {
  market = marketSelect.value;
  updateVehicleStatus();
  render();
});
vinForm.addEventListener("submit", async event => {
  event.preventDefault();
  const request = ++vehicleRequest;
  try {
    const result = await lookupSpider(vinInput.value);
    if (request !== vehicleRequest) return;
    if (!vehicle) marketBeforeVin = market;
    vehicle = result;
    market = result.fields.BUSREG?.[0] || marketBeforeVin;
    marketSelect.value = market;
    vinSeries.value = "";
    vinTransmission.value = "";
    vinInput.value = vinInput.value.trim().toUpperCase();
    updateVehicleStatus();
    render();
  } catch (error) {
    if (request !== vehicleRequest) return;
    vinInput.setAttribute("aria-invalid", "true");
    vinStatus.classList.add("error");
    vinStatus.textContent = `${error.message}${vehicle ? " The current VIN filter is still active." : ""}`;
  }
});
vinInput.addEventListener("input", () => { vehicleRequest++; });
clearVin.addEventListener("click", () => {
  vehicleRequest++;
  vehicle = null;
  vinInput.value = "";
  market = marketBeforeVin;
  marketSelect.value = market;
  updateVehicleStatus();
  render();
  vinInput.focus();
});
for (const input of [vinSeries, vinTransmission]) input.addEventListener("change", () => {
  updateVehicleStatus();
  render();
});
window.addEventListener("hashchange", render);
sectionToggle.addEventListener("click", () => {
  const open = !layout.classList.contains("sidebar-open");
  setSidebar(open);
  if (open) sidebar.querySelector('[aria-current="page"]')?.scrollIntoView({block: "nearest"});
});
render();
